import { readFileSync, writeFileSync } from 'node:fs'
import { chromiumDownloadUrl } from '../chromium-checksums/chromium-checksums.ts'

/**
 * Chrome for Testing's last known good version of each channel, with its downloads.
 *
 * @public
 */
export const stableBuildsUrl =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'

/**
 * The digest `chromium.json` holds until merging the bump publishes the image.
 *
 * @public
 */
export const unpublishedDigest = `sha256:${'0'.repeat(64)}`

/**
 * The name the CLI's peer dependency gives the browser package.
 */
const browserPackageName = '@visual-check/chromium'

/**
 * The browser package's `chromium.json`.
 *
 * @public
 */
export interface ChromiumData {
  /**
   * The Chromium version.
   */
  chromium: string
  /**
   * The image the CLI runs Chromium in.
   */
  image: {
    /**
     * The image's tag, ending with the browser package's version.
     */
    tag: string
    /**
     * The image index's digest, zeros until it's published.
     */
    digest: string
  }
  /**
   * The headless shell's path inside the image.
   */
  headlessShell: string
  /**
   * The SHA-256 of each headless shell zip, by Chrome for Testing platform.
   */
  sha256: Record<string, string>
}

/**
 * A `package.json`, with the fields the bump reads and every other field kept as it is.
 *
 * @public
 */
export interface PackageJson {
  /**
   * Any other field, kept when the file is written back.
   */
  [field: string]: unknown
  /**
   * The package version.
   */
  version: string
  /**
   * Peer dependencies.
   */
  peerDependencies?: Record<string, string>
}

/**
 * The files a browser package bump reads and writes.
 *
 * @public
 */
export interface BrowserPackageFiles {
  /**
   * `packages/chromium/package.json`.
   */
  chromiumManifest: PackageJson
  /**
   * `packages/chromium/chromium.json`.
   */
  chromiumData: ChromiumData
  /**
   * `packages/cli/package.json`.
   */
  cliManifest: PackageJson
}

/**
 * Where each of the bump's files lives under the repo root.
 */
const filePaths = {
  chromiumManifest: 'packages/chromium/package.json',
  chromiumData: 'packages/chromium/chromium.json',
  cliManifest: 'packages/cli/package.json',
} as const

/**
 * Reads the browser package's files and the CLI's manifest under the repo root.
 *
 * @public
 */
export function readBrowserPackageFiles(root: URL): BrowserPackageFiles {
  return {
    chromiumManifest: JSON.parse(readFileSync(new URL(filePaths.chromiumManifest, root), 'utf8')) as PackageJson,
    chromiumData: JSON.parse(readFileSync(new URL(filePaths.chromiumData, root), 'utf8')) as ChromiumData,
    cliManifest: JSON.parse(readFileSync(new URL(filePaths.cliManifest, root), 'utf8')) as PackageJson,
  }
}

/**
 * Writes the browser package's files and the CLI's manifest under the repo root, in the form Biome keeps.
 *
 * @public
 */
export function writeBrowserPackageFiles(root: URL, files: BrowserPackageFiles): void {
  for (const key of Object.keys(filePaths) as (keyof BrowserPackageFiles)[]) {
    writeFileSync(new URL(filePaths[key], root), `${JSON.stringify(files[key], null, 2)}\n`)
  }
}

/**
 * The build Chrome for Testing's Stable channel holds.
 *
 * @public
 */
export interface StableBuild {
  /**
   * The Chromium version, four numbers.
   */
  version: string
}

/**
 * A headless shell download in Chrome for Testing's response.
 */
interface Download {
  /**
   * The Chrome for Testing platform.
   */
  platform?: unknown
  /**
   * The zip's URL.
   */
  url?: unknown
}

/**
 * The parts of Chrome for Testing's response that the bump reads.
 */
interface StableResponse {
  /**
   * The channels by name.
   */
  channels?: {
    /**
     * The Stable channel.
     */
    Stable?: {
      /**
       * The Chromium version.
       */
      version?: unknown
      /**
       * The downloads by product.
       */
      downloads?: {
        /**
         * The headless shell zips.
         */
        'chrome-headless-shell'?: unknown
      }
    }
  }
}

/**
 * Reads Stable's version from Chrome for Testing's response, and checks it has each platform's headless shell at the
 * URL the checksum check downloads.
 *
 * @public
 */
export function readStableBuild(response: unknown, platforms: readonly string[]): StableBuild {
  const channel = (response as StableResponse | null)?.channels?.Stable

  if (typeof channel !== 'object' || channel === null) {
    throw new Error("Chrome for Testing's response has no Stable channel")
  }

  const version = channel.version

  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Chrome for Testing's Stable version "${String(version)}" isn't four numbers`)
  }

  const listed = channel.downloads?.['chrome-headless-shell']
  const downloads: Download[] = Array.isArray(listed) ? listed : []

  for (const platform of platforms) {
    const download = downloads.find((candidate) => candidate?.platform === platform)

    if (download === undefined) {
      throw new Error(`Chrome for Testing's Stable ${version} has no chrome-headless-shell download for ${platform}`)
    }

    const expected = chromiumDownloadUrl(version, platform)

    if (download.url !== expected) {
      throw new Error(
        `Chrome for Testing's Stable ${version} downloads ${platform} from ${String(download.url)}, not ${expected}`,
      )
    }
  }

  return { version }
}

/**
 * What a bump does: nothing, with the reason, or a new major or point release of the browser package.
 *
 * @public
 */
export type BumpPlan =
  | {
      /**
       * Nothing to do.
       */
      kind: 'none'
      /**
       * Why.
       */
      reason: string
    }
  | {
      /**
       * A new Chromium major, or a newer build of the same major.
       */
      kind: 'major' | 'point'
      /**
       * The new Chromium version.
       */
      chromium: string
      /**
       * The browser package's new version.
       */
      version: string
      /**
       * The CLI's new peer range on the browser package.
       */
      browserRange: string
    }

/**
 * A plan that changes the files.
 */
type PlannedBump = Extract<BumpPlan, { kind: 'major' | 'point' }>

/**
 * The numbers of a dotted version.
 */
function numbersOf(version: string): number[] {
  return version.split('.').map(Number)
}

/**
 * Compares two Chromium versions number by number: negative when `left` is older, zero when equal, positive when newer.
 */
function compareChromium(left: string, right: string): number {
  const leftNumbers = numbersOf(left)
  const rightNumbers = numbersOf(right)

  for (let index = 0; index < 4; index++) {
    const difference = (leftNumbers[index] ?? 0) - (rightNumbers[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/**
 * Reads the majors out of the CLI's browser range: one or more `^N.0.0` joined by `||`, as the CLI's `parseMajors`
 * accepts. Throws on any other shape.
 */
function majorsOf(range: string): number[] {
  const parts = range.split('||').map((part) => part.trim())

  if (!parts.every((part) => /^\^\d+\.0\.0$/.test(part))) {
    throw new Error(`The CLI's browser range must be one or more ^N.0.0 joined by ||, got "${range}"`)
  }

  return parts.map((part) => Number(part.slice(1, part.indexOf('.'))))
}

/**
 * Adds a major to the CLI's browser range, unless its majors already list it.
 */
function withMajor(range: string, majors: number[], major: number): string {
  if (majors.includes(major)) {
    return range
  }

  return `${range} || ^${major}.0.0`
}

/**
 * The CLI's peer range on the browser package.
 */
function browserRangeOf(files: BrowserPackageFiles): string {
  return files.cliManifest.peerDependencies?.[browserPackageName] ?? ''
}

/**
 * Plans the browser package's bump to Stable. The package only moves forward: a newer build of the same major is a
 * point release (the next minor), a higher major is that major's `.0.0` and joins the CLI's range.
 *
 * @public
 */
export function planBump(files: BrowserPackageFiles, stable: StableBuild): BumpPlan {
  const range = browserRangeOf(files)
  const current = files.chromiumData.chromium
  const version = files.chromiumManifest.version
  const majors = majorsOf(range)

  const comparison = compareChromium(stable.version, current)

  if (comparison === 0) {
    return {
      kind: 'none',
      reason: `Chrome for Testing's Stable is ${stable.version}, which the browser package ${version} holds`,
    }
  }

  if (comparison < 0) {
    return {
      kind: 'none',
      reason: `Chrome for Testing's Stable is ${stable.version}, older than the browser package ${version}'s ${current}: the browser package only moves forward`,
    }
  }

  const [stableMajor = 0] = numbersOf(stable.version)
  const [currentMajor] = numbersOf(current)

  if (stableMajor === currentMajor) {
    const [major, minor = 0] = numbersOf(version)

    return { kind: 'point', chromium: stable.version, version: `${major}.${minor + 1}.0`, browserRange: range }
  }

  return {
    kind: 'major',
    chromium: stable.version,
    version: `${stableMajor}.0.0`,
    browserRange: withMajor(range, majors, stableMajor),
  }
}

/**
 * Keys the new checksums in the package's platform order. Throws when one is missing, so no platform drops out.
 */
function inPlatformOrder(platforms: string[], sha256: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    platforms.map((platform) => {
      const checksum = sha256[platform]

      if (checksum === undefined) {
        throw new Error(`The new checksums have no ${platform}`)
      }

      return [platform, checksum]
    }),
  )
}

/**
 * Applies a plan to a copy of the files: the new version, Chromium, image tag, the unpublished digest and checksums,
 * and the CLI's range. Every other field and the key order stay.
 *
 * @public
 */
export function applyBump(
  files: BrowserPackageFiles,
  plan: PlannedBump,
  sha256: Record<string, string>,
): BrowserPackageFiles {
  const { chromiumData } = files
  const repository = chromiumData.image.tag.slice(0, chromiumData.image.tag.lastIndexOf(':'))

  return {
    chromiumManifest: { ...files.chromiumManifest, version: plan.version },
    chromiumData: {
      ...chromiumData,
      chromium: plan.chromium,
      image: { ...chromiumData.image, tag: `${repository}:${plan.version}`, digest: unpublishedDigest },
      sha256: inPlatformOrder(Object.keys(chromiumData.sha256), sha256),
    },
    cliManifest: {
      ...files.cliManifest,
      peerDependencies: { ...files.cliManifest.peerDependencies, [browserPackageName]: plan.browserRange },
    },
  }
}

/**
 * The bump pull request's branch, title and body.
 *
 * @public
 */
export interface BumpDescription {
  /**
   * The branch, `chromium-bump/<chromium>`.
   */
  branch: string
  /**
   * The pull request's title, which becomes its merge commit's.
   */
  title: string
  /**
   * The pull request's body, which becomes its merge commit's.
   */
  body: string
}

/**
 * Describes the bump pull request from the files before the bump. It's a CLI feature only when the CLI's range
 * changes. No line of the body starts with a footer release-please reads, because the body becomes the merge commit's
 * message.
 *
 * @public
 */
export function describeBump(files: BrowserPackageFiles, plan: PlannedBump): BumpDescription {
  const branch = `chromium-bump/${plan.chromium}`
  const [major] = numbersOf(plan.chromium)
  const currentRange = browserRangeOf(files)
  const rangeChanges = plan.browserRange !== currentRange
  // Only a changed range touches packages/cli, so only then is the merge commit a CLI feature.
  const title = rangeChanges
    ? `feat(cli): Chromium ${major} in the browser range, with the browser package ${plan.version}`
    : `build(chromium): Chromium ${plan.chromium}, as the browser package ${plan.version}`
  const change = plan.kind === 'major' ? 'a new major' : 'a point release'
  const rangeLine = rangeChanges
    ? [
        `- The CLI's browser range goes from \`${currentRange}\` to \`${plan.browserRange}\`. The next CLI release ships it.`,
      ]
    : []
  const body = [
    `Chrome for Testing's Stable channel moved from ${files.chromiumData.chromium} to ${plan.chromium}: ${change}.`,
    '',
    `- The browser package \`${browserPackageName}\` goes from ${files.chromiumManifest.version} to ${plan.version}, with the new checksums. Its \`image.digest\` stays zeros until merging publishes the image.`,
    ...rangeLine,
    '',
    'The Browser package bump workflow opened this pull request. A pull request a workflow opens starts no workflow, so it started CI, Browser package and Browser checksums on this branch. Pushing here starts them as usual.',
    '',
    '## Before merging',
    '',
    '- [ ] Browser package is green: it built both images, pushed them by digest and ran the test apps on the amd64 one. Merging publishes those images, not new builds.',
    "- [ ] The launch arguments in `packages/cli/src/capture/driver/cdp/launch-arguments.ts` match Playwright's latest release: https://github.com/microsoft/playwright/releases",
    `- [ ] Pixels. When this repository's test Storybooks differ, rewrite their baselines here (\`test-storybooks/storybook-10-react/README.md\` › Rewriting the baselines). When the test apps differ, rewrite theirs on a \`visual-check/test-apps\` branch named \`${branch}\`, with its Update baselines workflow and \`visual-check-ref\` set to \`${branch}\`. Then re-run all jobs of this branch's CI and Browser package runs. A re-run of failed jobs keeps the test-apps branch they found first.`,
    '- [ ] Merge this pull request, then the test-apps branch, if there is one.',
    '',
  ].join('\n')

  return { branch, title, body }
}
