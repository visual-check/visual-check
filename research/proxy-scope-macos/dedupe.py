# Proxy scope research: keeps each distinct snapshot once. <runs>/<arm>/run-N/png/<cell>.png becomes
# <out>/png/<sha1>.png, plus <out>/manifest.json: {arm: {run: {cell: sha1}}}.
#   python3 -I dedupe.py <runs> <out>
import hashlib, json, os, shutil, sys

runs, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, 'png'), exist_ok=True)
manifest = {}
for arm in sorted(os.listdir(runs)):
    if not os.path.isdir(os.path.join(runs, arm)): continue
    for run in sorted(os.listdir(os.path.join(runs, arm))):
        d = os.path.join(runs, arm, run, 'png')
        if not os.path.isdir(d): continue
        cells = manifest.setdefault(arm, {}).setdefault(run, {})
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            h = hashlib.sha1(open(p, 'rb').read()).hexdigest()
            cells[f[:-4]] = h
            dst = os.path.join(out, 'png', h + '.png')
            if not os.path.exists(dst): shutil.copyfile(p, dst)
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
print(f"{sum(len(c) for a in manifest.values() for c in a.values())} snapshots, {len(os.listdir(os.path.join(out, 'png')))} distinct")
