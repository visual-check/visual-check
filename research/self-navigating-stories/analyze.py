# RESEARCH, throwaway: per arm, how often the userflow stories lose their document, and what the in-page probe saw.
#   python3 -I analyze.py <root> [<root>...]   each root holds <arm>/run-<n>/run.json; roots are pooled per arm
import glob
import json
import os
import random
import statistics as st
import sys
from collections import defaultdict

SAFE = {'userflows-app--home', 'userflows-app--to-category-list-page'}  # no click on Burgers, never lose
runs = defaultdict(list)
for root in sys.argv[1:]:
    for f in sorted(glob.glob(os.path.join(root, '*', 'run-*', 'run.json'))):
        arm = f.split(os.sep)[-3]
        r = json.load(open(f))
        r['_job'] = root
        runs[arm].append(r)


def first_rate(r):
    a = [x for x in r['attempts'] if x['attempt'] == 1 and x['key'] not in SAFE]
    return (sum(1 for x in a if x.get('lost')), len(a))


def perm_p(xs, ys, n=10000):
    # two-sided permutation test on the difference of means, runs as units
    obs = abs(st.mean(xs) - st.mean(ys))
    pool = xs + ys
    hits = 0
    rnd = random.Random(1)
    for _ in range(n):
        rnd.shuffle(pool)
        if abs(st.mean(pool[:len(xs)]) - st.mean(pool[len(xs):])) >= obs - 1e-12:
            hits += 1
    return (hits + 1) / (n + 1)


def probe(att):
    log = att.get('log') or []
    tv = next((e['t'] for e in log if e['k'] == 'click' and str(e.get('tid', '')).startswith('View all')), None)
    md = next((e for e in log if e['k'] == 'mousedown' and e.get('tid') == 'Burgers'), None)
    ck = next((e for e in log if e['k'] == 'click' and e.get('tid') == 'Burgers'), None)
    if tv is None or ck is None:
        return None
    tc = next((e['t'] for e in log if e['k'] == 'burgers' and e['t'] > tv and e.get('on') and not e['on'].startswith('Hungry')), None)
    after = [e for e in log if e['t'] > ck['t']]
    navigated = next((e['path'] for e in after if e['k'] == 'doc'), None)
    return {
        'commit': None if tc is None else tc - tv,  # click on "View all restaurants" to the category list in the DOM
        'press': md['t'] - tv if md else None,  # to user-event pressing on "Burgers"
        'click': ck['t'] - tv,  # to the click on "Burgers"
        'conPress': md['con'] if md else None,
        'conClick': ck['con'],
        'navigated': navigated,
    }


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


rows = []
per_run = {}
for arm in sorted(runs):
    rs = runs[arm]
    fr = [first_rate(r) for r in rs]
    per_run[arm] = [l / n for l, n in fr if n]
    lost1, n1 = sum(l for l, _ in fr), sum(n for _, n in fr)
    retries = [x for r in rs for x in r['attempts'] if x['attempt'] > 1]
    lostr = sum(1 for x in retries if x.get('lost'))
    by = defaultdict(list)
    for r in rs:
        for x in r['attempts']:
            by[(id(r), x['key'], x['cycle'])].append(x)
    lost3 = sum(1 for v in by.values() if sum(1 for x in v if x['attempt'] <= 3 and x.get('lost')) == 3)
    lost5 = sum(1 for r in rs for x in r['results'] if x.get('reason') == 'navigated away')
    other = sum(1 for r in rs for x in r['results'] if x.get('reason') and x.get('reason') != 'navigated away')
    stories = sum(len(r['results']) for r in rs if True) - sum(1 for r in rs for x in r['results'] if x['key'] in SAFE)
    cps = st.median(r['capturesPerS'] for r in rs)
    ok_ms = [x['ms'] for r in rs for x in r['attempts'] if not x.get('lost') and not x.get('reason') and x['key'] not in SAFE]
    rows.append((arm, len(rs), lost1, n1, lostr, len(retries), lost3, lost5, stories, other, cps, st.median(ok_ms) if ok_ms else 0))

print(f"{'arm':16} {'runs':>4} {'1st lost':>12} {'retry lost':>12} {'away@3':>7} {'away@5':>7} {'other':>5} {'cap/s':>6} {'ms ok':>6}  p vs raw  p vs pw")
for arm, n, l1, n1, lr, nr, a3, a5, ns, other, cps, ms in rows:
    pr = perm_p(per_run[arm], per_run['raw']) if 'raw' in per_run and arm != 'raw' else float('nan')
    pp = perm_p(per_run[arm], per_run['pw']) if 'pw' in per_run and arm != 'pw' else float('nan')
    print(f"{arm:16} {n:4} {l1:4}/{n1:<4} {l1 / max(n1, 1):4.0%} {lr:4}/{nr:<4} {lr / max(nr, 1):3.0%} {a3:3}/{ns:<4}{a5:3} {other:5} {cps:6.2f} {ms:6.0f}  {pr:7.4f} {pp:7.4f}")

print('\nProbe, on vulnerable attempts: ms from the click on "View all restaurants"')
print(f"{'arm':16} {'n':>5} {'commit p25/50/75':>18} {'press p25/50/75':>18} {'detached click: lost/all':>26} {'lost, attached':>14} {'nav to':>22}")
for arm in sorted(runs):
    ps = [(x, probe(x)) for r in runs[arm] for x in r['attempts'] if x['key'] not in SAFE]
    ps = [(x, p) for x, p in ps if p]
    if not ps:
        continue
    commit = [p['commit'] for _, p in ps if p['commit'] is not None]
    press = [p['press'] for _, p in ps if p['press'] is not None]
    det = [(x, p) for x, p in ps if p['conClick'] is False]
    det_lost = sum(1 for x, _ in det if x.get('lost'))
    lost_att = sum(1 for x, p in ps if x.get('lost') and p['conClick'])
    navs = defaultdict(int)
    for x, p in ps:
        if x.get('lost'):
            navs[p['navigated']] += 1
    top = max(navs.items(), key=lambda kv: kv[1])[0] if navs else '-'
    fmt = lambda xs: '/'.join(f"{q(xs, p):.0f}" for p in (0.25, 0.5, 0.75)) if xs else '-'
    print(f"{arm:16} {len(ps):5} {fmt(commit):>18} {fmt(press):>18} {det_lost:>12}/{len(det):<13} {lost_att:>14} {str(top):>22}")
