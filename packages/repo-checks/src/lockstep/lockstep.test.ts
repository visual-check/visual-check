import { describe, expect, it } from 'vitest'
import { readWorkspaceManifests, repoRoot } from '../workspace/manifests.ts'
import { findLockstepProblems, lockstepPackages } from './lockstep.ts'

const lockstep = (versions: [string, string, string]) =>
  lockstepPackages.map((name, index) => ({ name, version: versions[index] as string }))

describe('findLockstepProblems', () => {
  it('returns no problems when all lockstep packages share a version', () => {
    expect(findLockstepProblems(lockstep(['0.1.0', '0.1.0', '0.1.0']))).toEqual([])
  })

  it('reports one problem naming every package when one differs', () => {
    expect(findLockstepProblems(lockstep(['0.1.0', '0.1.0', '0.2.0']))).toEqual([
      'Lockstep packages must share one version: @visual-check/cli 0.1.0, @visual-check/storybook 0.1.0, @visual-check/storybook-addon 0.2.0',
    ])
  })

  it('reports a missing lockstep package', () => {
    const manifests = lockstep(['0.1.0', '0.1.0', '0.1.0']).slice(0, 2)
    expect(findLockstepProblems(manifests)).toEqual(['@visual-check/storybook-addon is missing from the workspace'])
  })

  it('ignores packages outside the lockstep group', () => {
    const manifests = [...lockstep(['0.1.0', '0.1.0', '0.1.0']), { name: '@visual-check/chromium', version: '9.9.9' }]
    expect(findLockstepProblems(manifests)).toEqual([])
  })

  it('finds no problems in the real workspace', () => {
    expect(findLockstepProblems(readWorkspaceManifests(repoRoot))).toEqual([])
  })
})
