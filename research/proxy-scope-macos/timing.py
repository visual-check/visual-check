# Proxy scope research: external resource timing per arm, from run.json files (<root>/<arm>/run-*/run.json).
# Per arm and host: resources seen by screenshot time, and their fetch duration (responseEnd - startTime) quantiles.
# Also capture time quantiles, and the proxy's connect times when there is a proxy log.
#   python3 -I timing.py <root> [<root>...]
import json, sys, glob, os
from collections import defaultdict
from urllib.parse import urlparse

def q(xs, p):
    if not xs: return '-'
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))]

arms = defaultdict(list)
for root in sys.argv[1:]:
    for f in sorted(glob.glob(os.path.join(root, '*', 'run-*', 'run.json'))):
        arms[f.split(os.sep)[-3]].append(json.load(open(f)))
for arm, runs in sorted(arms.items()):
    dur = defaultdict(list); n = defaultdict(int); caps = []
    for r in runs:
        caps += [ms for _, ms in r['msPerCapture']]
        for key, res in r.get('resources', []):
            if not res: continue
            for name, kind, start, end in res['res']:
                h = urlparse(name).hostname; dur[h].append(end - start); n[h] += 1
    print(f"## {arm}: {len(runs)} runs, wall s {[r['wallS'] for r in runs]}, capture ms p50 {q(caps,.5)} p90 {q(caps,.9)} max {max(caps) if caps else '-'}")
    for h in sorted(dur, key=lambda h: -n[h]):
        d = dur[h]; print(f"   {h:32} n={n[h]/len(runs):6.1f}/run  fetch ms p50 {q(d,.5)} p90 {q(d,.9)} p99 {q(d,.99)} max {max(d)}")
    logs = [l for r in runs for l in (r.get('socksLog') or [])]
    if logs:
        by = defaultdict(list)
        for l in logs:
            if 'connectMs' in l: by[l['host']].append(l['connectMs'])
        print(f"   proxy: {len(logs)/len(runs):.0f} connections/run, max open {[r['socks'].get('maxOpen') for r in runs]}, failed {[r['socks']['failed'] for r in runs]}")
        for h, c in sorted(by.items(), key=lambda kv: -len(kv[1])):
            print(f"      {h:32} {len(c)/len(runs):6.1f}/run connect ms p50 {q(c,.5)} p90 {q(c,.9)} max {max(c)}")
