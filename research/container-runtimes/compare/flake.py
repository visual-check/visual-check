# Usage: python3 -I flake.py <runsRoot> <arm> <pass> [refArms comma list]
# For each story where the arm's runs don't all equal the reference consensus: does any arm run match any reference run?
import json, os, sys, collections
root, arm, p = sys.argv[1:4]
refs = sys.argv[4].split(',') if len(sys.argv) > 4 else ['gha-1', 'gha-2', 'gha-3']
def runs(a): return sorted(d for d in os.listdir(f'{root}/{a}') if d.startswith('run-') and os.path.exists(f'{root}/{a}/{d}/{p}.json'))
def shots(a, r): return json.load(open(f'{root}/{a}/{r}/{p}.json'))['shots']
ref_runs = [shots(a, r) for a in refs for r in runs(a)]
arm_runs = [shots(arm, r) for r in runs(arm)]
out = collections.Counter(); ex = collections.defaultdict(list)
for sid in arm_runs[0]:
    rs = collections.Counter(s[sid].get('sha') for s in ref_runs if s.get(sid, {}).get('sha'))
    if not rs: continue
    cons = rs.most_common(1)[0][0]
    a = [s[sid].get('sha') for s in arm_runs if s.get(sid, {}).get('sha')]
    if not a or all(x == cons for x in a): continue
    if any(x == cons for x in a): k = 'arm runs disagree; one matches runner consensus'
    elif any(x in rs for x in a): k = 'matches a non-majority runner run'
    else: k = 'never seen on runners'
    out[k] += 1; ex[k].append(sid)
for k, v in out.items(): print(v, k, ex[k][:12])
