// Budgets for "force amd64 everywhere": Rosetta locally (with or without the flag) against runner baselines.
import { readFileSync } from 'node:fs'
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const T = ['0', '0.005', '0.01', '0.02', '0.1']
const GHA = ['gha-1', 'gha-2', 'gha-3']
const raster = (rows) => rows.filter((x) => x.px > 0 && x.maxCh <= 10)
const per = (k) => Object.values(r.cross[k]?.per ?? {})
for (const pass of ['chromium', 'noskia']) {
  const rows = [...GHA.flatMap((g) => raster(per(`rosetta~${g}/${pass}`))), ...['gha-2~gha-1', 'gha-3~gha-1', 'gha-3~gha-2'].flatMap((k) => raster(per(`${k}/${pass}`))),
    ...Object.entries(r.noise).filter(([k]) => k.endsWith(`/${pass}`) && (k.startsWith('gha') || k.startsWith('rosetta'))).flatMap(([, v]) => v.rows.filter((x) => x.maxCh <= 10))]
  const b = Object.fromEntries(T.map((t) => [t, Math.max(0, ...rows.map((x) => x.pm?.[t] ?? 0))]))
  console.log(`${pass} budget: ${T.map((t) => `${t}:${b[t]}`).join(' ')}`)
  for (const m of ['shift', 'text', 'icon', 'color4', 'color8', 'color16']) {
    const self = r.mutations[`arm64/mut-${m}~arm64`] ?? {}
    const ids = Object.keys(self).filter((id) => self[id].target && self[id].px > 0)
    console.log(`  ${m.padEnd(8)} n=${ids.length} caught ${T.map((t) => `${t}:${ids.filter((id) => self[id].pm[t] > b[t]).length}`).join(' ')}`)
  }
}
// The amd64 runner's own deliberate changes (older targeting, so colour is left out), against its own baseline.
for (const m of ['shift', 'text', 'icon']) {
  const self = r.mutations[`gha-1/mut-${m}~gha-1`] ?? {}
  const ids = Object.keys(self).filter((id) => self[id].target && self[id].px > 0)
  const px = ids.map((id) => self[id].px).sort((a, b) => a - b)
  console.log(`gha-1 ${m} n=${ids.length} median ${px[Math.floor(px.length / 2)]} min ${px[0]} pm0.02>0: ${ids.filter((id) => self[id].pm['0.02'] > 0).length} pm0.01>2: ${ids.filter((id) => self[id].pm['0.01'] > 2).length}`)
}
