// Both imports go through the package's own exports, so the test fails to load when either export breaks.
import data from '@visual-check/chromium' with { type: 'json' }
import manifest from '@visual-check/chromium/package.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'

describe('chromium.json', () => {
  it('has exactly the keys chromium, image, headlessShell and sha256', () => {
    expect(Object.keys(data).sort()).toEqual(['chromium', 'headlessShell', 'image', 'sha256'])
  })

  it('names a four-part Chromium version', () => {
    expect(data.chromium).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
  })

  it('gives the package a three-part version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('uses the Chromium major as the package major', () => {
    expect(manifest.version.split('.')[0]).toBe(data.chromium.split('.')[0])
  })

  it('has an image with exactly a tag and a digest', () => {
    expect(Object.keys(data.image).sort()).toEqual(['digest', 'tag'])
  })

  it('tags the image with the package version', () => {
    expect(data.image.tag).toBe(`ghcr.io/visual-check/chromium:${manifest.version}`)
  })

  it('writes the image digest as sha256 and 64 hex digits', () => {
    expect(data.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('points the headless shell at an absolute POSIX path', () => {
    expect(data.headlessShell.startsWith('/')).toBe(true)
    expect(data.headlessShell.split('/')).not.toContain('..')
    expect(data.headlessShell).not.toContain('\\')
  })

  it('has a hash for exactly the five Chrome for Testing platforms', () => {
    expect(Object.keys(data.sha256).sort()).toEqual(['linux-arm64', 'linux64', 'mac-arm64', 'mac-x64', 'win64'])
  })

  it('writes every platform hash as 64 lowercase hex digits', () => {
    for (const hash of Object.values(data.sha256)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('package.json', () => {
  it.each(['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'])(
    'has no %s',
    (field) => {
      expect(manifest).not.toHaveProperty(field)
    },
  )

  it.each(['preinstall', 'install', 'postinstall', 'prepare'])('has no %s script', (script) => {
    expect(manifest.scripts).not.toHaveProperty(script)
  })

  it('publishes only chromium.json', () => {
    expect(manifest.files).toEqual(['chromium.json'])
  })
})
