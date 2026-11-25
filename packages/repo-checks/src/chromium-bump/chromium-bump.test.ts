import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../workspace/manifests.ts'
import {
  applyBump,
  type BrowserPackageFiles,
  describeBump,
  planBump,
  readBrowserPackageFiles,
  readStableBuild,
  unpublishedDigest,
} from './chromium-bump.ts'

/**
 * The recorded Chrome for Testing response, whose Stable channel holds Chromium 158.0.8127.88.
 */
const recordedResponse: unknown = JSON.parse(
  readFileSync(new URL('fixtures/last-known-good-versions-with-downloads.json', import.meta.url), 'utf8'),
)

/**
 * The Stable version of the recorded response.
 */
const stable = '158.0.8127.88'

/**
 * The platforms the browser package lists checksums for, in its order.
 */
const platforms = ['linux64', 'linux-arm64', 'mac-x64', 'mac-arm64', 'win64']

/**
 * The real browser package files, before any test changes them.
 */
const realFiles = readBrowserPackageFiles(repoRoot)

/**
 * Builds the browser package files for a Chromium version, a package version and a CLI range, with the real files'
 * other fields.
 */
function filesFor(chromium: string, version: string, range: string): BrowserPackageFiles {
  return {
    chromiumManifest: { ...realFiles.chromiumManifest, version },
    chromiumData: {
      ...realFiles.chromiumData,
      chromium,
      image: { tag: `ghcr.io/visual-check/chromium:${version}`, digest: unpublishedDigest },
    },
    cliManifest: {
      ...realFiles.cliManifest,
      peerDependencies: { ...realFiles.cliManifest.peerDependencies, '@visual-check/chromium': range },
    },
  }
}

/**
 * The Stable build the recorded response holds.
 */
const stableBuild = readStableBuild(recordedResponse, platforms)

/**
 * Plans the bump of the files to the recorded Stable, failing the test when there's none.
 */
function plannedBump(files: BrowserPackageFiles) {
  const plan = planBump(files, stableBuild)

  if (plan.kind === 'none') {
    throw new Error(plan.reason)
  }

  return plan
}

/**
 * A headless shell download in the recorded response.
 */
interface RecordedDownload {
  /**
   * The Chrome for Testing platform.
   */
  platform: string
  /**
   * The zip's URL.
   */
  url: string
}

/**
 * The parts of the recorded response a test changes.
 */
interface MutableResponse {
  /**
   * The channels by name.
   */
  channels: {
    /**
     * The Stable channel.
     */
    Stable: {
      /**
       * The Chromium version.
       */
      version: string
      /**
       * The downloads by product.
       */
      downloads: {
        /**
         * The headless shell zips.
         */
        'chrome-headless-shell': RecordedDownload[]
      }
    }
  }
}

describe('readStableBuild', () => {
  it('reads the Stable version from the recorded response for the five platforms', () => {
    expect(stableBuild).toEqual({ version: stable })
  })

  it.each<[string, (response: MutableResponse) => void, string]>([
    [
      'no Stable channel',
      (response) => {
        Reflect.deleteProperty(response.channels, 'Stable')
      },
      "Chrome for Testing's response has no Stable channel",
    ],
    [
      'a version of two numbers',
      (response) => {
        response.channels.Stable.version = '158.0'
      },
      `Chrome for Testing's Stable version "158.0" isn't four numbers`,
    ],
    [
      'no linux64 headless shell download',
      (response) => {
        const downloads = response.channels.Stable.downloads

        downloads['chrome-headless-shell'] = downloads['chrome-headless-shell'].filter(
          (download) => download.platform !== 'linux64',
        )
      },
      `Chrome for Testing's Stable ${stable} has no chrome-headless-shell download for linux64`,
    ],
    [
      'a win64 URL on another host',
      (response) => {
        for (const download of response.channels.Stable.downloads['chrome-headless-shell']) {
          if (download.platform === 'win64') {
            download.url = download.url.replace('storage.googleapis.com', 'example.com')
          }
        }
      },
      `Chrome for Testing's Stable ${stable} downloads win64 from https://example.com/chrome-for-testing-public/${stable}/win64/chrome-headless-shell-win64.zip, not https://storage.googleapis.com/chrome-for-testing-public/${stable}/win64/chrome-headless-shell-win64.zip`,
    ],
  ])('throws on %s', (_case, mutate, message) => {
    const response = structuredClone(recordedResponse) as MutableResponse

    mutate(response)

    expect(() => readStableBuild(response, platforms)).toThrow(new Error(message))
  })
})

describe('planBump', () => {
  it('does nothing when the browser package holds Stable', () => {
    expect(planBump(filesFor(stable, '158.0.0', '^158.0.0'), stableBuild)).toEqual({
      kind: 'none',
      reason: `Chrome for Testing's Stable is ${stable}, which the browser package 158.0.0 holds`,
    })
  })

  it('plans a point release when Stable is a newer build of the same major', () => {
    expect(planBump(filesFor('158.0.8100.12', '158.1.0', '^157.0.0 || ^158.0.0'), stableBuild)).toEqual({
      kind: 'point',
      chromium: stable,
      version: '158.2.0',
      browserRange: '^157.0.0 || ^158.0.0',
    })
  })

  it('plans a new major and adds it to the range', () => {
    expect(planBump(filesFor('157.0.8103.78', '157.0.0', '^157.0.0'), stableBuild)).toEqual({
      kind: 'major',
      chromium: stable,
      version: '158.0.0',
      browserRange: '^157.0.0 || ^158.0.0',
    })
  })

  it('keeps a range that already lists the new major', () => {
    expect(planBump(filesFor('157.0.8103.78', '157.0.0', '^157.0.0 || ^158.0.0'), stableBuild)).toEqual({
      kind: 'major',
      chromium: stable,
      version: '158.0.0',
      browserRange: '^157.0.0 || ^158.0.0',
    })
  })

  it.each([
    ['a higher major', '159.0.8200.5', '159.0.0'],
    ['a newer build of the same major', '158.0.8127.100', '158.1.0'],
  ])('does nothing when the browser package holds %s', (_case, chromium, version) => {
    expect(planBump(filesFor(chromium, version, '^158.0.0 || ^159.0.0'), stableBuild)).toEqual({
      kind: 'none',
      reason: `Chrome for Testing's Stable is ${stable}, older than the browser package ${version}'s ${chromium}: the browser package only moves forward`,
    })
  })

  it('throws on a range of another shape', () => {
    expect(() => planBump(filesFor('157.0.8103.78', '157.0.0', '>=157.0.0'), stableBuild)).toThrow(
      new Error(`The CLI's browser range must be one or more ^N.0.0 joined by ||, got ">=157.0.0"`),
    )
  })
})

describe('applyBump', () => {
  const before = filesFor('157.0.8103.78', '157.0.0', '^157.0.0')
  const sha256 = { win64: 'e', linux64: 'a', 'mac-arm64': 'd', 'linux-arm64': 'b', 'mac-x64': 'c' }

  it('sets the version, Chromium, image tag, zeros digest and checksums in the package order', () => {
    const after = applyBump(before, plannedBump(before), sha256)

    expect(after.chromiumManifest.version).toBe('158.0.0')
    expect(after.chromiumData.chromium).toBe(stable)
    expect(after.chromiumData.image).toEqual({
      tag: 'ghcr.io/visual-check/chromium:158.0.0',
      digest: unpublishedDigest,
    })
    expect(Object.entries(after.chromiumData.sha256)).toEqual([
      ['linux64', 'a'],
      ['linux-arm64', 'b'],
      ['mac-x64', 'c'],
      ['mac-arm64', 'd'],
      ['win64', 'e'],
    ])
    expect(after.cliManifest.peerDependencies?.['@visual-check/chromium']).toBe('^157.0.0 || ^158.0.0')
  })

  it('leaves every other field and the key order', () => {
    const after = applyBump(before, plannedBump(before), sha256)

    expect(after.chromiumData.headlessShell).toBe(before.chromiumData.headlessShell)
    expect(after.chromiumManifest.files).toEqual(before.chromiumManifest.files)
    expect(Object.keys(after.chromiumManifest)).toEqual(Object.keys(before.chromiumManifest))
    expect(Object.keys(after.chromiumData)).toEqual(Object.keys(before.chromiumData))
    expect(Object.keys(after.cliManifest)).toEqual(Object.keys(before.cliManifest))
    expect({ ...after.cliManifest, peerDependencies: undefined }).toEqual({
      ...before.cliManifest,
      peerDependencies: undefined,
    })
  })

  it('throws when a platform has no checksum', () => {
    const withoutWin64 = Object.fromEntries(Object.entries(sha256).filter(([platform]) => platform !== 'win64'))

    expect(() => applyBump(before, plannedBump(before), withoutWin64)).toThrow(
      new Error('The new checksums have no win64'),
    )
  })

  it('leaves the CLI manifest equal for a point release', () => {
    const point = filesFor('158.0.8100.12', '158.1.0', '^157.0.0 || ^158.0.0')
    const after = applyBump(point, plannedBump(point), sha256)

    expect(after.chromiumManifest.version).toBe('158.2.0')
    expect(after.cliManifest).toEqual(point.cliManifest)
  })
})

describe('describeBump', () => {
  const majorFiles = filesFor('157.0.8103.78', '157.0.0', '^157.0.0')
  const major = describeBump(majorFiles, plannedBump(majorFiles))
  const pointFiles = filesFor('158.0.8100.12', '158.1.0', '^157.0.0 || ^158.0.0')
  const point = describeBump(pointFiles, plannedBump(pointFiles))

  it('names the branch after the new Chromium', () => {
    expect(major.branch).toBe(`chromium-bump/${stable}`)
    expect(point.branch).toBe(`chromium-bump/${stable}`)
  })

  it('titles a new major as a CLI feature and a point release as a build of the browser package', () => {
    expect(major.title).toBe('feat(cli): Chromium 158 in the browser range, with the browser package 158.0.0')
    expect(point.title).toBe(`build(chromium): Chromium ${stable}, as the browser package 158.2.0`)
  })

  it('names the old and new versions, and the range only for a new major', () => {
    expect(major.body).toContain(`moved from 157.0.8103.78 to ${stable}: a new major.`)
    expect(major.body).toContain('goes from 157.0.0 to 158.0.0')
    expect(major.body).toContain('goes from `^157.0.0` to `^157.0.0 || ^158.0.0`')
    expect(point.body).toContain(`moved from 158.0.8100.12 to ${stable}: a point release.`)
    expect(point.body).toContain('goes from 158.1.0 to 158.2.0')
    expect(point.body).not.toContain("The CLI's browser range")
    expect(major.body).toContain(`a \`visual-check/test-apps\` branch named \`chromium-bump/${stable}\``)
  })

  it('leaves the range out, and titles a build of the browser package, when the range already lists the new major', () => {
    const listedFiles = filesFor('157.0.8103.78', '157.0.0', '^157.0.0 || ^158.0.0')
    const listed = describeBump(listedFiles, plannedBump(listedFiles))

    expect(listed.title).toBe(`build(chromium): Chromium ${stable}, as the browser package 158.0.0`)
    expect(listed.body).toContain(`moved from 157.0.8103.78 to ${stable}: a new major.`)
    expect(listed.body).not.toContain("The CLI's browser range")
  })

  it('starts no line with a footer release-please reads', () => {
    expect(major.body).not.toMatch(/^(BREAKING[ -]CHANGE|Release-As):/m)
    expect(point.body).not.toMatch(/^(BREAKING[ -]CHANGE|Release-As):/m)
  })
})

describe('the files the bump writes', () => {
  it.each(['packages/chromium/package.json', 'packages/chromium/chromium.json', 'packages/cli/package.json'])(
    'keep their form: %s',
    (path) => {
      const text = readFileSync(new URL(path, repoRoot), 'utf8')

      expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`).toBe(text)
    },
  )
})
