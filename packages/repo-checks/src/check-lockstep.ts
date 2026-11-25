import { findLockstepProblems, lockstepPackages } from './lockstep/lockstep.ts'
import { findReleasePleaseProblems, readReleasePleaseSetup } from './lockstep/release-please.ts'
import { readWorkspaceManifests, repoRoot } from './workspace/manifests.ts'

const manifests = readWorkspaceManifests(repoRoot)
const problems = [...findLockstepProblems(manifests), ...findReleasePleaseProblems(readReleasePleaseSetup(repoRoot))]

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem)
  }

  process.exitCode = 1
} else {
  const version = manifests.find((manifest) => manifest.name === lockstepPackages[0])?.version

  console.log(`Lockstep versions match: ${version}, and release-please links exactly the lockstep group`)
}
