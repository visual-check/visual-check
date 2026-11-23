import { describe, expect, it } from 'vitest'
import { localVersionOf, manifestWithVersions } from './local-packages.ts'

describe('localVersionOf', () => {
  const date = new Date('2026-11-23T09:05:07.123Z')

  it('adds local and the UTC time to the second as a prerelease', () => {
    expect(localVersionOf('0.1.0', date)).toBe('0.1.0-local.20261123090507')
  })

  it('adds them to a version that is a prerelease already', () => {
    expect(localVersionOf('0.1.0-beta.2', date)).toBe('0.1.0-beta.2.local.20261123090507')
  })
})

describe('manifestWithVersions', () => {
  const versions = new Map([
    ['@visual-check/cli', '0.1.0-local.1'],
    ['@visual-check/storybook-addon', '0.1.0-local.1'],
  ])

  it('sets the version of a package it names, and each dependency on one it names, to that exact version', () => {
    const manifest = {
      name: '@visual-check/storybook-addon',
      version: '0.1.0',
      main: './dist/index.js',
      dependencies: { '@visual-check/cli': '0.1.0', react: '^19.0.0' },
      peerDependencies: { '@visual-check/cli': '0.1.0', storybook: '^10.0.0' },
      optionalDependencies: { '@visual-check/cli': '^0.1.0' },
    }

    expect(manifestWithVersions(manifest, versions)).toEqual({
      name: '@visual-check/storybook-addon',
      version: '0.1.0-local.1',
      main: './dist/index.js',
      dependencies: { '@visual-check/cli': '0.1.0-local.1', react: '^19.0.0' },
      peerDependencies: { '@visual-check/cli': '0.1.0-local.1', storybook: '^10.0.0' },
      optionalDependencies: { '@visual-check/cli': '0.1.0-local.1' },
    })
  })

  it("leaves a package it doesn't name at its version, and its dependencies on others", () => {
    const manifest = {
      name: '@visual-check/chromium',
      version: '157.0.0',
      peerDependencies: { '@visual-check/storybook': '0.1.0' },
    }

    expect(manifestWithVersions(manifest, versions)).toEqual(manifest)
  })

  it('adds no dependency field the manifest has none of', () => {
    expect(manifestWithVersions({ name: '@visual-check/cli', version: '0.1.0' }, versions)).toEqual({
      name: '@visual-check/cli',
      version: '0.1.0-local.1',
    })
  })
})
