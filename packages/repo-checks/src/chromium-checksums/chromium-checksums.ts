import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * The fields of `packages/chromium/chromium.json` that the checksum check reads.
 *
 * @public
 */
export interface ChromiumChecksums {
  /**
   * The Chromium version.
   */
  chromium: string
  /**
   * The SHA-256 of each headless shell zip, by Chrome for Testing platform.
   */
  sha256: Record<string, string>
}

/**
 * Reads the Chromium version and checksums from `packages/chromium/chromium.json` under the repo root.
 *
 * @public
 */
export function readChromiumChecksums(root: URL): ChromiumChecksums {
  const { chromium, sha256 } = JSON.parse(
    readFileSync(new URL('packages/chromium/chromium.json', root), 'utf8'),
  ) as ChromiumChecksums

  return { chromium, sha256 }
}

/**
 * The Chrome for Testing download URL of a headless shell zip.
 *
 * @public
 */
export function chromiumDownloadUrl(chromium: string, platform: string): string {
  return `https://storage.googleapis.com/chrome-for-testing-public/${chromium}/${platform}/chrome-headless-shell-${platform}.zip`
}

/**
 * The SHA-256 of a URL's body, hashed as it streams in.
 */
async function sha256OfUrl(url: string, fetcher: (url: string) => Promise<Response>): Promise<string> {
  const response = await fetcher(url)

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  if (response.body === null) {
    throw new Error('empty body')
  }

  const hash = createHash('sha256')

  for await (const chunk of response.body) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

/**
 * Words a failed download of a platform's zip, with the error's cause when it has one.
 */
function downloadFailure(platform: string, url: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''

  return `${platform}: download failed (${url}): ${message}${cause}`
}

/**
 * Downloads every listed headless shell zip and lists each one whose hash differs or that fails to download.
 *
 * @public
 */
export async function findChecksumProblems(
  data: ChromiumChecksums,
  fetcher: (url: string) => Promise<Response> = fetch,
): Promise<string[]> {
  const results = await Promise.all(
    Object.entries(data.sha256).map(async ([platform, expected]) => {
      const url = chromiumDownloadUrl(data.chromium, platform)

      try {
        const actual = await sha256OfUrl(url, fetcher)

        return actual === expected ? [] : [`${platform}: expected ${expected}, got ${actual} (${url})`]
      } catch (error) {
        return [downloadFailure(platform, url, error)]
      }
    }),
  )

  return results.flat()
}

/**
 * Downloads each platform's headless shell zip of a Chromium version and hashes it, keyed in the platforms' order.
 * Rejects on the first download that fails, naming its platform and URL.
 *
 * @public
 */
export async function computeChecksums(
  chromium: string,
  platforms: readonly string[],
  fetcher: (url: string) => Promise<Response> = fetch,
): Promise<Record<string, string>> {
  const hashes = await Promise.all(
    platforms.map(async (platform) => {
      const url = chromiumDownloadUrl(chromium, platform)

      try {
        return [platform, await sha256OfUrl(url, fetcher)] as const
      } catch (error) {
        throw new Error(downloadFailure(platform, url, error))
      }
    }),
  )

  return Object.fromEntries(hashes)
}
