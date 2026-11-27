import { describe, expect, it } from 'vitest'
import {
  configNamesImage,
  imagePlanOf,
  localVersionOf,
  manifestWithVersions,
  packageJsonWithVersions,
} from './local-packages.ts'

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
      devDependencies: { '@visual-check/cli': 'workspace:*', vitest: '^5.0.0' },
      peerDependencies: { '@visual-check/cli': '0.1.0', storybook: '^10.0.0' },
      optionalDependencies: { '@visual-check/cli': '^0.1.0' },
    }

    expect(manifestWithVersions(manifest, versions)).toEqual({
      name: '@visual-check/storybook-addon',
      version: '0.1.0-local.1',
      main: './dist/index.js',
      dependencies: { '@visual-check/cli': '0.1.0-local.1', react: '^19.0.0' },
      devDependencies: { '@visual-check/cli': '0.1.0-local.1', vitest: '^5.0.0' },
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

describe('packageJsonWithVersions', () => {
  const versions = new Map([
    ['@visual-check/cli', '0.1.1-local.1'],
    ['@visual-check/chromium', '157.0.0'],
  ])

  it('sets each dependency it names, in every list, to that exact version, and leaves every other field', () => {
    const text = JSON.stringify(
      {
        name: 'my-app',
        private: true,
        scripts: { 'visual:check': 'visual-check test' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { '@visual-check/chromium': '^157.0.0', '@visual-check/cli': '^0.1.1', vite: '^7.0.0' },
        peerDependencies: { '@visual-check/cli': '>=0.1.0' },
        optionalDependencies: { '@visual-check/cli': 'catalog:' },
      },
      null,
      2,
    )

    expect(JSON.parse(packageJsonWithVersions(text, versions) ?? '')).toEqual({
      name: 'my-app',
      private: true,
      scripts: { 'visual:check': 'visual-check test' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { '@visual-check/chromium': '157.0.0', '@visual-check/cli': '0.1.1-local.1', vite: '^7.0.0' },
      peerDependencies: { '@visual-check/cli': '0.1.1-local.1' },
      optionalDependencies: { '@visual-check/cli': '0.1.1-local.1' },
    })
  })

  it('keeps the indent and the final newline', () => {
    const tabbed = '{\n\t"devDependencies": {\n\t\t"@visual-check/cli": "0.1.1"\n\t}\n}\n'
    const spaced = '{\n    "devDependencies": {\n        "@visual-check/cli": "0.1.1"\n    }\n}'

    expect(packageJsonWithVersions(tabbed, versions)).toBe(
      '{\n\t"devDependencies": {\n\t\t"@visual-check/cli": "0.1.1-local.1"\n\t}\n}\n',
    )
    expect(packageJsonWithVersions(spaced, versions)).toBe(
      '{\n    "devDependencies": {\n        "@visual-check/cli": "0.1.1-local.1"\n    }\n}',
    )
  })

  it("gives undefined for one that lists none of them, even by another package's name", () => {
    const text = '{\n  "name": "@visual-check/cli",\n  "dependencies": { "@visual-check/storybook": "0.1.1" }\n}\n'

    expect(packageJsonWithVersions(text, versions)).toBeUndefined()
    expect(packageJsonWithVersions('{ "name": "my-app" }', versions)).toBeUndefined()
  })
})

describe('imagePlanOf', () => {
  const tag = 'ghcr.io/visual-check/chromium:157.0.0'
  const published = { tag, digest: `sha256:${'ab'.repeat(32)}` }
  const unpublished = { tag, digest: `sha256:${'0'.repeat(64)}` }
  const reference = `${tag}@${published.digest}`

  it('leaves the image to a published browser package when none is asked for', () => {
    expect(imagePlanOf(undefined, published)).toEqual({ kind: 'package', reference })
  })

  it("names the image CI builds when none is asked for and the browser package's isn't published", () => {
    expect(imagePlanOf(undefined, unpublished)).toEqual({
      kind: 'config',
      image: 'visual-check-chromium:ci',
      pullable: false,
    })
  })

  it('leaves the image to a published browser package when its tag, or its tag and digest, is asked for', () => {
    expect(imagePlanOf(tag, published)).toEqual({ kind: 'package', reference })
    expect(imagePlanOf(reference, published)).toEqual({ kind: 'package', reference })
  })

  it("names the unpublished browser package's tag, which no registry serves yet", () => {
    expect(imagePlanOf(tag, unpublished)).toEqual({ kind: 'config', image: tag, pullable: false })
  })

  it('names any other image, pullable when its first path segment names a registry', () => {
    expect(imagePlanOf('ghcr.io/acme/chromium:1', published)).toEqual({
      kind: 'config',
      image: 'ghcr.io/acme/chromium:1',
      pullable: true,
    })
    expect(imagePlanOf('localhost:5000/x', published)).toMatchObject({ pullable: true })
    expect(imagePlanOf('localhost/x', published)).toMatchObject({ pullable: true })
    expect(imagePlanOf('registry:5000/x', published)).toMatchObject({ pullable: true })
    expect(imagePlanOf('visual-check-chromium:ci', published)).toEqual({
      kind: 'config',
      image: 'visual-check-chromium:ci',
      pullable: false,
    })
    expect(imagePlanOf('acme/chromium:1', published)).toMatchObject({ pullable: false })
  })

  it("names another pullable image when the browser package's isn't published", () => {
    expect(imagePlanOf('ghcr.io/acme/chromium:1', unpublished)).toEqual({
      kind: 'config',
      image: 'ghcr.io/acme/chromium:1',
      pullable: true,
    })
  })
})

describe('configNamesImage', () => {
  it('finds an image on a line of its own', () => {
    expect(configNamesImage("export default defineConfig({\n  image: 'acme:1',\n})\n")).toBe(true)
  })

  it('finds none in a config without one', () => {
    expect(configNamesImage('export default defineConfig({\n  storybooks: {},\n})\n')).toBe(false)
  })
})
