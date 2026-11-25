import { describe, expect, it } from 'vitest'
import { repoRoot } from '../workspace/manifests.ts'
import { findReleasePleaseProblems, type ReleasePleaseSetup, readReleasePleaseSetup } from './release-please.ts'

/**
 * Builds a release-please setup that releases exactly the lockstep group, linked, at `0.0.0`.
 */
const validSetup = (): ReleasePleaseSetup => ({
  packages: {
    'packages/cli': { component: 'cli' },
    'packages/storybook': { component: 'storybook' },
    'packages/storybook-addon': { component: 'storybook-addon' },
  },
  plugins: [
    { type: 'linked-versions', groupName: 'visual-check', components: ['cli', 'storybook', 'storybook-addon'] },
  ],
  releasedVersions: {
    'packages/cli': '0.0.0',
    'packages/storybook': '0.0.0',
    'packages/storybook-addon': '0.0.0',
  },
  manifests: {
    'packages/cli': { name: '@visual-check/cli', version: '0.0.0' },
    'packages/storybook': { name: '@visual-check/storybook', version: '0.0.0' },
    'packages/storybook-addon': { name: '@visual-check/storybook-addon', version: '0.0.0' },
  },
  groupPullRequestTitlePattern: `chore\${scope}: release visual-check libraries`,
})

/**
 * The problem a missing or wrong group title pattern gives, for the `visual-check` group.
 */
const patternProblem = `group-pull-request-title-pattern must be "chore\${scope}: release visual-check libraries", the linked-versions plugin's release PR title, or release-please makes no release from that PR (googleapis/release-please#2306)`

describe('findReleasePleaseProblems', () => {
  it('returns no problems when release-please links exactly the lockstep group', () => {
    expect(findReleasePleaseProblems(validSetup())).toEqual([])
  })

  it('reports a package outside the lockstep group', () => {
    const setup = validSetup()

    setup.packages['packages/chromium'] = { component: 'chromium' }
    setup.manifests['packages/chromium'] = { name: '@visual-check/chromium', version: '157.0.0' }

    expect(findReleasePleaseProblems(setup)).toEqual([
      'packages/chromium is in release-please-config.json, but release-please releases the lockstep group alone',
    ])
  })

  it("reports a lockstep package release-please doesn't release", () => {
    const setup = validSetup()

    delete setup.packages['packages/storybook-addon']
    delete setup.releasedVersions['packages/storybook-addon']
    delete setup.manifests['packages/storybook-addon']
    setup.plugins = [{ type: 'linked-versions', groupName: 'visual-check', components: ['cli', 'storybook'] }]

    expect(findReleasePleaseProblems(setup)).toEqual([
      "@visual-check/storybook-addon isn't a package in release-please-config.json",
    ])
  })

  it('reports a lockstep package with no component', () => {
    const setup = validSetup()

    setup.packages['packages/storybook'] = {}

    expect(findReleasePleaseProblems(setup)).toEqual([
      'packages/storybook has no component in release-please-config.json, which the linked-versions plugin needs',
      'The linked-versions plugin links cli, storybook, storybook-addon, but the lockstep group is cli, storybook-addon',
    ])
  })

  it.each([
    { count: 0, plugins: ['sentence-case'] },
    {
      count: 2,
      plugins: [
        'sentence-case',
        { type: 'linked-versions', groupName: 'visual-check', components: ['cli', 'storybook', 'storybook-addon'] },
        { type: 'linked-versions', groupName: 'other', components: ['chromium'] },
      ],
    },
  ])('reports $count linked-versions plugins', ({ count, plugins }) => {
    const setup = validSetup()

    setup.plugins = plugins

    expect(findReleasePleaseProblems(setup)).toEqual([
      `release-please-config.json needs one linked-versions plugin, and has ${count}`,
    ])
  })

  it.each([
    {
      components: ['cli', 'storybook'],
      problem:
        'The linked-versions plugin links cli, storybook, but the lockstep group is cli, storybook, storybook-addon',
    },
    {
      components: ['chromium', 'cli', 'storybook', 'storybook-addon'],
      problem:
        'The linked-versions plugin links chromium, cli, storybook, storybook-addon, but the lockstep group is cli, storybook, storybook-addon',
    },
  ])('reports a linked-versions plugin that links $components', ({ components, problem }) => {
    const setup = validSetup()

    setup.plugins = [{ type: 'linked-versions', groupName: 'visual-check', components }]

    expect(findReleasePleaseProblems(setup)).toEqual([problem])
  })

  it('reports a missing group title pattern', () => {
    const setup = validSetup()

    delete setup.groupPullRequestTitlePattern

    expect(findReleasePleaseProblems(setup)).toEqual([patternProblem])
  })

  it('reports a group title pattern naming another group', () => {
    const setup = validSetup()

    setup.groupPullRequestTitlePattern = `chore\${scope}: release other libraries`

    expect(findReleasePleaseProblems(setup)).toEqual([patternProblem])
  })

  it('reports a lockstep version the manifest records differently', () => {
    const setup = validSetup()

    setup.releasedVersions['packages/cli'] = '0.1.0'
    setup.manifests['packages/cli'] = { name: '@visual-check/cli', version: '0.2.0' }

    expect(findReleasePleaseProblems(setup)).toEqual([
      'packages/cli: .release-please-manifest.json has 0.1.0, and package.json has 0.2.0',
    ])
  })

  it('reports a lockstep version the manifest lacks', () => {
    const setup = validSetup()

    delete setup.releasedVersions['packages/storybook']

    expect(findReleasePleaseProblems(setup)).toEqual([
      'packages/storybook: .release-please-manifest.json has no version, and package.json has 0.0.0',
    ])
  })

  it('finds no problems in the real repo', () => {
    expect(findReleasePleaseProblems(readReleasePleaseSetup(repoRoot))).toEqual([])
  })
})
