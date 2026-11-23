import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buffer } from 'node:stream/consumers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { imageMiddleware } from './image-route.js'

/**
 * The bytes of the image.
 */
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])

/**
 * An answer of the server.
 */
interface Answer {
  /**
   * The status.
   */
  status: number | undefined
  /**
   * The headers.
   */
  headers: NodeJS.Dict<string | string[]>
  /**
   * The body.
   */
  body: Buffer
}

/**
 * The folder of the files.
 */
let folder: string

/**
 * A server as Storybook 10.0's: it lets every origin read, answers `next` with 418, and may cut a prefix off `url`.
 */
let server: Server

/**
 * Finds the files: an image, one whose file is gone, and a folder.
 */
const findImage = vi.fn((id: string, path: string): string | undefined => {
  const files: Partial<Record<string, string>> = {
    'click-1 diffs/web/a.png': 'a.png',
    'click-1 gone.png': 'gone.png',
    'click-1 folder.png': '.',
  }
  const file = files[`${id} ${path}`]

  return file === undefined ? undefined : join(folder, file)
})

/**
 * Sends a request with its path as it is, which `fetch` would normalize.
 */
async function send(path: string, { method = 'GET', headers = {} } = {}): Promise<Answer> {
  const { port } = server.address() as AddressInfo

  return await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, method, headers, agent: false }, async (response) => {
      resolve({ status: response.statusCode, headers: response.headers, body: await buffer(response) })
    })
      .on('error', reject)
      .end()
  })
}

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'visual-check-image-route-'))
  writeFileSync(join(folder, 'a.png'), bytes)

  const middleware = imageMiddleware(findImage)

  server = createServer((incoming, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    void middleware(incoming, response, () => response.writeHead(418).end())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(folder, { recursive: true, force: true })
})

describe('imageMiddleware', () => {
  it.each([
    '/__visual-check/images/click-1/diffs/web/a.png',
    '/docs/__visual-check/images/click-1/diffs/web/a.png?v=1',
  ])('serves an image to this Storybook alone, uncached: %s', async (path) => {
    const { status, headers, body } = await send(path)

    expect(status).toBe(200)
    expect(body).toEqual(bytes)
    expect(headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': '8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    })
    expect(headers).not.toHaveProperty('access-control-allow-origin')
  })

  it('reads the whole URL when a middleware in front cut a part off', async () => {
    const response = { removeHeader: vi.fn(), setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }
    const url = '/click-1/diffs/web/a.png'
    const incoming = { method: 'GET', headers: {}, url, originalUrl: `/__visual-check/images${url}` }
    const next = vi.fn()

    await imageMiddleware(findImage)(incoming as never, response as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(response.end).toHaveBeenCalledWith(bytes)
  })

  it('answers HEAD without the image', async () => {
    const { status, headers, body } = await send('/__visual-check/images/click-1/diffs/web/a.png', { method: 'HEAD' })

    expect(status).toBe(200)
    expect(headers['content-length']).toBe('8')
    expect(body).toHaveLength(0)
  })

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('refuses %s', async (method) => {
    const { status, headers } = await send('/__visual-check/images/click-1/diffs/web/a.png', { method })

    expect(status).toBe(405)
    expect(headers.allow).toBe('GET, HEAD')
    expect(headers).not.toHaveProperty('access-control-allow-origin')
  })

  it.each(['cross-site', 'same-site', 'junk'])('refuses a page of another origin: %s', async (site) => {
    const { status, headers, body } = await send('/__visual-check/images/click-1/diffs/web/a.png', {
      headers: { 'Sec-Fetch-Site': site },
    })

    expect(status).toBe(403)
    expect(body).toHaveLength(0)
    expect(headers).not.toHaveProperty('access-control-allow-origin')
  })

  it.each(['same-origin', 'none'])('serves a request whose Sec-Fetch-Site is %s', async (site) => {
    const { status } = await send('/__visual-check/images/click-1/diffs/web/a.png', {
      headers: { 'Sec-Fetch-Site': site },
    })

    expect(status).toBe(200)
  })

  it.each(['click-2/diffs/web/a.png', 'click-1/b.png', 'click-1', '', 'click-1/gone.png', 'click-1/folder.png'])(
    'answers 404 for an image that is not there: %s',
    async (rest) => {
      const { status, headers, body } = await send(`/__visual-check/images/${rest}`)

      expect(status).toBe(404)
      expect(headers['cache-control']).toBe('no-store')
      expect(body).toHaveLength(0)
    },
  )

  it.each([
    'click-1/../../../../etc/passwd',
    'click-1/diffs/web/../web/a.png',
    'click-1/%2e%2e/%2e%2e/etc/passwd',
    'click-1/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    'click-1/diffs/web/a.png%00',
    'click-1/%00',
    'click-1//etc/passwd',
    'click-1/%2fetc%2fpasswd',
    'click-1/..\\..\\windows',
    'click-1/diffs%5Cweb%5Ca.png',
    'click-1/C:%5Cwindows',
    'click-1/%',
  ])('answers 404 for a path no image has: %s', async (rest) => {
    const { status, body } = await send(`/__visual-check/images/${rest}`)

    expect(status).toBe(404)
    expect(body).toHaveLength(0)
  })

  it.each([
    '/',
    '/index.json',
    '/__visual-check/images',
    '/iframe.html?x=/__visual-check/images/click-1/diffs/web/a.png',
  ])('passes every other URL on, as it is: %s', async (path) => {
    const { status, headers } = await send(path, { method: 'POST' })

    expect(status).toBe(418)
    expect(headers['access-control-allow-origin']).toBe('*')
    expect(headers).not.toHaveProperty('cache-control')
  })
})
