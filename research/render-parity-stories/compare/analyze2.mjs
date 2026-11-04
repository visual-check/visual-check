// Usage: node analyze2.mjs <report.json>
// Budgets come from raster-level differences only (max channel <= 10); larger ones are content flakes that recapture handles.
import { readFileSync } from 'node:fs'

const r = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const T = ['0', '0.005', '0.01', '0.02', '0.05', '0.1']
const RASTER = 10
const GHA = ['gha-1', 'gha-2', 'gha-3']
const pct = (n) => `${((100 * n) / 921600).toFixed(3)}%`
const rowsOf = (key) => Object.values(r.cross[key]?.per ?? {})
const raster = (rows) => rows.filter((x) => x.px > 0 && x.maxCh <= RASTER)
const content = (rows) => rows.filter((x) => x.px > 0 && x.maxCh > RASTER)

console.log('## Per pair (consensus snapshots): differing stories, raster/content, max %, max channel of raster rows, pixelmatch max at thresholds (raster rows)')
for (const pass of ['chromium', 'noskia', 'webkit']) {
  for (const [label, keys] of [
    ['arm64 vs runner', GHA.map((g) => `arm64~${g}`)],
    ['Rosetta vs runner', GHA.map((g) => `rosetta~${g}`)],
    ['runner vs runner', ['gha-2~gha-1', 'gha-3~gha-1', 'gha-3~gha-2']],
    ['arm64 vs Rosetta', ['arm64~rosetta']],
  ]) {
    const parts = keys.map((k) => rowsOf(`${k}/${pass}`))
    const diff = parts.map((p) => p.filter((x) => x.px > 0).length)
    const rs = parts.flatMap(raster)
    const cs = parts.map((p) => content(p).length)
    console.log(`${pass.padEnd(8)} ${label.padEnd(18)} differing ${diff.join('/')} content ${cs.join('/')} raster max ${pct(Math.max(0, ...rs.map((x) => x.px)))} ch ${Math.max(0, ...rs.map((x) => x.maxCh))} | ${T.map((t) => `${t}:${Math.max(0, ...rs.map((x) => x.pm?.[t] ?? 0))}`).join(' ')}`)
  }
}

console.log('\n## Same-arm noise: comparisons, differing (raster/content), raster max px and ch, content max px')
for (const [k, v] of Object.entries(r.noise)) {
  const rs = v.rows.filter((x) => x.maxCh <= RASTER), cs = v.rows.filter((x) => x.maxCh > RASTER)
  console.log(`${k.padEnd(18)} ${v.compared} cmp, ${rs.length} raster in ${new Set(rs.map((x) => x.id)).size} stories (max ${Math.max(0, ...rs.map((x) => x.px))} px, ch ${Math.max(0, ...rs.map((x) => x.maxCh))}), ${cs.length} content in ${new Set(cs.map((x) => x.id)).size} stories (max ${Math.max(0, ...cs.map((x) => x.px))} px) | ${T.map((t) => `${t}:${Math.max(0, ...rs.map((x) => x.pm?.[t] ?? 0))}`).join(' ')}`)
}

// Budget b(t): the largest raster count arm64-vs-runner, runner-vs-runner or same-arm noise gives at threshold t.
const budget = (pass, withArm64) => {
  const keys = [...(withArm64 ? GHA.map((g) => `arm64~${g}`) : []), 'gha-2~gha-1', 'gha-3~gha-1', 'gha-3~gha-2']
  const rows = [...keys.flatMap((k) => raster(rowsOf(`${k}/${pass}`))),
    ...Object.entries(r.noise).filter(([k]) => k.endsWith(`/${pass}`) && (withArm64 || k.startsWith('gha')) && !k.startsWith('rosetta')).flatMap(([, v]) => v.rows.filter((x) => x.maxCh <= RASTER))]
  return Object.fromEntries(T.map((t) => [t, Math.max(0, ...rows.map((x) => x.pm?.[t] ?? 0))]))
}
for (const [label, withArm64] of [['arm64 + runners', true], ['runners only', false]]) {
  const b = budget('chromium', withArm64)
  console.log(`\n## Chromium budget to absorb ${label}: ${T.map((t) => `${t}:${b[t]} (${pct(b[t])})`).join('  ')}`)
  console.log('caught = mutated snapshot over budget, of stories where the change is visible on its own arm')
  for (const m of ['shift', 'text', 'icon', 'color4', 'color8', 'color16']) {
    const self = r.mutations[`arm64/mut-${m}~arm64`] ?? {}
    const visible = Object.keys(self).filter((id) => self[id].target && self[id].px > 0)
    for (const base of ['gha-1', 'arm64']) {
      const per = r.mutations[`arm64/mut-${m}~${base}`] ?? {}
      const ids = visible.filter((id) => per[id])
      console.log(`  ${m.padEnd(8)} vs ${base.padEnd(6)} n=${String(ids.length).padStart(3)} caught ${T.map((t) => `${t}:${ids.filter((id) => per[id].pm[t] > b[t]).length}`).join('  ')}`)
    }
  }
}
const bw = budget('webkit', true)
console.log(`\n## WebKit budget to absorb arm64 + runners: ${T.map((t) => `${t}:${bw[t]} (${pct(bw[t])})`).join('  ')}`)

console.log('\n## Exact size of each visible change on its own arm (arm64), px: median, p10, min')
for (const m of ['shift', 'text', 'icon', 'color4', 'color8', 'color16']) {
  const px = Object.values(r.mutations[`arm64/mut-${m}~arm64`] ?? {}).filter((x) => x.target && x.px > 0).map((x) => x.px).sort((a, b) => a - b)
  console.log(`  ${m.padEnd(8)} n=${px.length} median ${px[Math.floor(px.length / 2)]} p10 ${px[Math.floor(px.length / 10)]} min ${px[0]}`)
}
console.log('\n## Speed: median ms per capture (runs pooled), wall s per run')
for (const [k, v] of Object.entries(r.speed)) console.log(`  ${k.padEnd(18)} median ${v.median} p90 ${v.p90} wall ${v.wallS.join(' ')}`)
console.log('\n## Flag on vs off, same arm (consensus)')
for (const [k, v] of Object.entries(r.flagEffect)) console.log(`  ${k.padEnd(8)} differing ${v.differing} max ${v.pctMax?.toFixed(3)}% ch ${v.maxCh}`)
console.log('\n## Agreement of runs per arm')
for (const [k, v] of Object.entries(r.agreement)) console.log(`  ${k.padEnd(18)} all ${v.allAgree} majority ${v.majority} none ${v.none.length}`)
console.log('\n## Broken')
for (const [k, v] of Object.entries(r.broken)) if (v.length) console.log(`  ${k}: ${v.join('; ')}`)
console.log('\n## Env')
for (const [k, v] of Object.entries(r.arms)) console.log(`  ${k}: ${v?.cpuModel} ${v?.simdFlags?.join(',')} nproc ${v?.nproc} ${v?.chrome} webkit ${v?.webkitVersion} shell ${v?.shellSha256?.slice(0, 12)} fc ${v?.fontconfigListSha256?.slice(0, 12)}`)
