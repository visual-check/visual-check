import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../workspace/manifests.ts'
import { chromiumDownloadUrl, findChecksumProblems, readChromiumChecksums } from './chromium-checksums.ts'

const chunks = [
  new TextEncoder().encode('first chunk, '),
  new TextEncoder().encode('second chunk, '),
  new Uint8Array(70000),
]
const expectedHash = createHash('sha256').update(Buffer.concat(chunks)).digest('hex')
const version = '157.0.8103.78'

function streamedResponse(failAfterFirstChunk = false): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)

          if (failAfterFirstChunk) {
            controller.error(new Error('reset'))

            return
          }
        }

        controller.close()
      },
    }),
  )
}

describe('chromiumDownloadUrl', () => {
  it('points at the headless shell zip for the platform', () => {
    expect(chromiumDownloadUrl(version, 'mac-arm64')).toBe(
      'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.78/mac-arm64/chrome-headless-shell-mac-arm64.zip',
    )
  })
})

describe('readChromiumChecksums', () => {
  it('reads a four-part version and the five platforms from the workspace', () => {
    const data = readChromiumChecksums(repoRoot)

    expect(data.chromium).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(Object.keys(data.sha256).sort()).toEqual(['linux-arm64', 'linux64', 'mac-arm64', 'mac-x64', 'win64'])
  })
})

describe('findChecksumProblems', () => {
  const data = { chromium: version, sha256: { linux64: expectedHash, win64: expectedHash } }

  it('returns nothing when every streamed hash matches', async () => {
    expect(await findChecksumProblems(data, async () => streamedResponse())).toEqual([])
  })

  it('names the platform, both hashes and the URL on a mismatch', async () => {
    const problems = await findChecksumProblems(
      { ...data, sha256: { linux64: expectedHash, win64: 'abc' } },
      async () => streamedResponse(),
    )

    expect(problems).toEqual([`win64: expected abc, got ${expectedHash} (${chromiumDownloadUrl(version, 'win64')})`])
  })

  it('names the platform, URL and status when the response is not OK', async () => {
    const problems = await findChecksumProblems(data, async (url) =>
      url.includes('/win64/') ? new Response('', { status: 500 }) : streamedResponse(),
    )

    expect(problems).toEqual([`win64: download failed (${chromiumDownloadUrl(version, 'win64')}): HTTP 500`])
  })

  it('reports an empty body', async () => {
    const problems = await findChecksumProblems({ chromium: version, sha256: { win64: expectedHash } }, async () => {
      return new Response(null, { status: 204 })
    })

    expect(problems).toEqual([`win64: download failed (${chromiumDownloadUrl(version, 'win64')}): empty body`])
  })

  it('names the cause when the fetch rejects', async () => {
    const problems = await findChecksumProblems({ chromium: version, sha256: { win64: expectedHash } }, async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })
    })

    expect(problems).toEqual([
      `win64: download failed (${chromiumDownloadUrl(version, 'win64')}): fetch failed: connect ECONNREFUSED`,
    ])
  })

  it('reports a stream that errors partway', async () => {
    const problems = await findChecksumProblems({ chromium: version, sha256: { win64: expectedHash } }, async () =>
      streamedResponse(true),
    )

    expect(problems).toEqual([`win64: download failed (${chromiumDownloadUrl(version, 'win64')}): reset`])
  })
})
