import { appendFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  applyBump,
  describeBump,
  planBump,
  readBrowserPackageFiles,
  readStableBuild,
  stableBuildsUrl,
  writeBrowserPackageFiles,
} from './chromium-bump/chromium-bump.ts'
import { computeChecksums } from './chromium-checksums/chromium-checksums.ts'
import { repoRoot } from './workspace/manifests.ts'

const { values } = parseArgs({ options: { 'body-file': { type: 'string' } } })
const bodyFile = values['body-file']
const outputFile = process.env.GITHUB_OUTPUT

/**
 * Appends `name=value` lines to the step's outputs, when the run has them.
 */
function writeOutputs(outputs: Record<string, string>): void {
  if (outputFile === undefined || outputFile === '') {
    return
  }

  const lines = Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`)

  appendFileSync(outputFile, lines.join(''))
}

if (bodyFile === undefined) {
  console.error('Usage: node packages/repo-checks/src/bump-chromium.ts --body-file <path>')
  process.exitCode = 2
} else {
  const files = readBrowserPackageFiles(repoRoot)
  const platforms = Object.keys(files.chromiumData.sha256)
  const response = await fetch(stableBuildsUrl)

  if (!response.ok) {
    throw new Error(`${stableBuildsUrl} answered HTTP ${response.status}`)
  }

  const stable = readStableBuild(await response.json(), platforms)
  const plan = planBump(files, stable)

  if (plan.kind === 'none') {
    console.log(plan.reason)
    writeOutputs({ changed: 'false' })
  } else {
    const sha256 = await computeChecksums(plan.chromium, platforms)
    const description = describeBump(files, plan)

    writeBrowserPackageFiles(repoRoot, applyBump(files, plan, sha256))
    writeFileSync(bodyFile, description.body)
    writeOutputs({
      changed: 'true',
      branch: description.branch,
      title: description.title,
      version: plan.version,
      chromium: plan.chromium,
    })
    console.log(
      `Bumped Chromium ${files.chromiumData.chromium} to ${plan.chromium}, and the browser package ${files.chromiumManifest.version} to ${plan.version}`,
    )
  }
}
