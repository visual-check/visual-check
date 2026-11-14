import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseIndex, readStories } from './read-stories.js'
import { StorybookError, StorybookUnreachableError } from './storybook-error.js'

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

/**
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

/**
 * Builds an index entry for a story, with the given fields overriding the defaults.
 */
function entryOf(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, title: 'Button', name: id, importPath: './src/Button.stories.tsx', type: 'story', ...fields }
}

/**
 * Makes a temporary Storybook folder holding `src/Button.stories.tsx`. Returns its real path.
 */
function createStorybookFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-stories-')))

  folders.push(folder)
  mkdirSync(join(folder, 'src'))
  writeFileSync(join(folder, 'src', 'Button.stories.tsx'), '')

  return folder
}

/**
 * Starts the server on a free port, to be closed after the test. Returns its URL.
 */
async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * Takes a port nothing listens on: listens on a free port, reads it and closes that server. Returns the URL it had.
 */
async function takeUnusedUrl(): Promise<string> {
  const server = createServer()

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })

  return url
}

/**
 * Starts a server on a free port that answers every request with the given status and body, and records the path of
 * each request. Returns its address and the record.
 */
async function startServer(status: number, body: string): Promise<{ url: string; paths: string[] }> {
  const paths: string[] = []
  const url = await listen(
    createServer((request, response) => {
      paths.push(request.url ?? '')
      response.statusCode = status
      response.end(body)
    }),
  )

  return { url, paths }
}

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

describe('parseIndex', () => {
  it('keeps the stories, in index order', () => {
    expect(parseIndex({ v: 5, entries: { a: entryOf('button--primary'), b: entryOf('button--secondary') } })).toEqual([
      { id: 'button--primary', title: 'Button', name: 'button--primary', importPath: './src/Button.stories.tsx' },
      { id: 'button--secondary', title: 'Button', name: 'button--secondary', importPath: './src/Button.stories.tsx' },
    ])
  })

  it('drops docs entries', () => {
    const stories = parseIndex({
      entries: { a: entryOf('button--primary'), b: entryOf('button--docs', { type: 'docs' }) },
    })

    expect(stories.map((story) => story.id)).toEqual(['button--primary'])
  })

  it('drops CSF Next test entries', () => {
    const stories = parseIndex({
      entries: { a: entryOf('button--primary'), b: entryOf('button--primary:test', { subtype: 'test' }) },
    })

    expect(stories.map((story) => story.id)).toEqual(['button--primary'])
  })

  it('keeps entries with the story subtype and entries with no subtype', () => {
    const stories = parseIndex({
      entries: { a: entryOf('one', { subtype: 'story' }), b: entryOf('two') },
    })

    expect(stories.map((story) => story.id)).toEqual(['one', 'two'])
  })

  it.each([
    [null, 'it has no entries object'],
    [[], 'it has no entries object'],
    [{}, 'it has no entries object'],
    [{ entries: [] }, 'it has no entries object'],
    [{ entries: { a: 1 } }, "entry a isn't an object"],
    [
      { entries: { a: entryOf('button--primary', { importPath: undefined }) } },
      'entry button--primary has no importPath',
    ],
    [{ entries: { a: entryOf('button--primary', { type: undefined }) } }, 'entry button--primary has no type'],
    [{ entries: { a: { title: 'Button' } } }, 'entry a has no id'],
    [
      { entries: { a: entryOf('button--primary', { title: 7 }) } },
      "entry button--primary has a title that isn't a string",
    ],
  ])('rejects %j with a reason', (json, reason) => {
    expect(() => parseIndex(json)).toThrow(reason)
  })
})

describe('readStories', () => {
  it('returns the stories of the index', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(200, JSON.stringify({ v: 5, entries: { a: entryOf('button--primary') } }))

    expect(await readStories({ name: 'web', url, dir }, dir)).toEqual([
      { id: 'button--primary', title: 'Button', name: 'button--primary', importPath: './src/Button.stories.tsx' },
    ])
  })

  it.each(['/storybook', '/storybook/'])('reaches index.json under the path of a URL ending in %j', async (path) => {
    const dir = createStorybookFolder()
    const { url, paths } = await startServer(200, JSON.stringify({ entries: {} }))

    await readStories({ name: 'web', url: `${url}${path}`, dir }, dir)

    expect(paths).toEqual(['/storybook/index.json'])
  })

  it('names the status and the body of an index that fails', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(500, '  SyntaxError in Button.stories.tsx  ')

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookError)
    expect(error).not.toBeInstanceOf(StorybookUnreachableError)
    expect((error as Error).message).toBe(
      `Storybook web's index.json failed at ${url}/index.json: HTTP 500 Internal Server Error.\n` +
        'SyntaxError in Button.stories.tsx\n' +
        "Fix what Storybook reports: on a dev server, a stories file that doesn't parse breaks index.json.",
    )
  })

  it('cuts a long body and leaves out an empty one', async () => {
    const dir = createStorybookFolder()
    const long = await startServer(500, 'x'.repeat(600))
    const empty = await startServer(404, '')

    const longError = await readStories({ name: 'web', url: long.url, dir }, dir).catch((caught: unknown) => caught)
    const emptyError = await readStories({ name: 'web', url: empty.url, dir }, dir).catch((caught: unknown) => caught)

    expect((longError as Error).message).toContain(`\n${'x'.repeat(500)}…\n`)
    expect((emptyError as Error).message).toBe(
      `Storybook web's index.json failed at ${empty.url}/index.json: HTTP 404 Not Found.\n` +
        'Check that the URL points at the running Storybook.',
    )
  })

  it('says a Storybook that answers 401 asks for a login, and names the fix', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(401, 'Basic realm secret-realm')

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookError)
    expect(error).not.toBeInstanceOf(StorybookUnreachableError)
    expect((error as Error).message).toBe(
      `Storybook web asks for a login at ${url}/index.json (HTTP 401 Unauthorized). ` +
        'visual-check sends no login: serve Storybook where visual-check runs (storybook dev, or its static build ' +
        'served in the same CI job) and point its URL at that.',
    )
  })

  it('says a redirect to a page that is not an index likely leads to a login page, without the final query', async () => {
    const dir = createStorybookFolder()
    const login = await listen(
      createServer((_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end('<html>Sign in</html>')
      }),
    )
    const url = await listen(
      createServer((_request, response) => {
        response.statusCode = 302
        response.setHeader('location', `${login}/sso/login?token=hunter2`)
        response.end()
      }),
    )

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookError)
    expect((error as Error).message).toBe(
      `Storybook web's index.json at ${url}/index.json redirected to ${login}/sso/login and didn't get a Storybook ` +
        'index, likely a login page. visual-check sends no login: serve Storybook where visual-check runs ' +
        '(storybook dev, or its static build served in the same CI job) and point its URL at that.',
    )
  })

  it('keeps the body of a 403 and ends with the URL check', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(403, 'Blocked request. This host is not allowed.')

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe(
      `Storybook web's index.json failed at ${url}/index.json: HTTP 403 Forbidden.\n` +
        'Blocked request. This host is not allowed.\n' +
        'Check that the URL points at the running Storybook.',
    )
  })

  it('rejects a body that is not JSON', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(200, '<html></html>')

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookError)
    expect((error as Error).message).toContain(
      `Storybook web's index.json at ${url}/index.json isn't a Storybook index: `,
    )
    expect((error as Error).message).toContain('Check that the URL points at Storybook 9.1 or later.')
  })

  it('rejects JSON that is not an index', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(200, '{}')

    await expect(readStories({ name: 'web', url, dir }, dir)).rejects.toThrow(
      `Storybook web's index.json at ${url}/index.json isn't a Storybook index: it has no entries object. ` +
        'Check that the URL points at Storybook 9.1 or later.',
    )
  })

  it('names the stories files that are not on disk, each once and relative to the current folder', async () => {
    const dir = createStorybookFolder()
    const { url } = await startServer(
      200,
      JSON.stringify({
        entries: {
          a: entryOf('card--one', { importPath: './src/Card.stories.tsx' }),
          b: entryOf('card--two', { importPath: './src/Card.stories.tsx' }),
          c: entryOf('button--primary'),
          d: entryOf('badge--one', { importPath: './src/Badge.stories.tsx' }),
        },
      }),
    )

    await expect(readStories({ name: 'web', url, dir }, dir)).rejects.toThrow(
      "Storybook web's index.json lists stories files that aren't on disk: src/Card.stories.tsx, src/Badge.stories.tsx. " +
        'Check storybooks.web.dir in the config, or restart Storybook so it indexes the current files.',
    )
  })

  it('strips a query, a hash and credentials from the URL, keeping the path', async () => {
    const dir = createStorybookFolder()
    const { url, paths } = await startServer(200, JSON.stringify({ entries: {} }))
    const credentialsUrl = url.replace('http://', 'http://user:secret@')

    await readStories({ name: 'web', url: `${url}/storybook?x=1#top`, dir }, dir)
    await readStories({ name: 'web', url: `${credentialsUrl}/storybook`, dir }, dir)

    expect(paths).toEqual(['/storybook/index.json', '/storybook/index.json'])
  })

  it('never prints the credentials of a URL', async () => {
    const dir = createStorybookFolder()
    const down = await takeUnusedUrl()

    const error = await readStories(
      { name: 'web', url: down.replace('http://', 'http://user:secret@'), dir },
      dir,
    ).catch((caught: unknown) => caught)

    expect((error as Error).message).toContain(`${down}/index.json`)
    expect((error as Error).message).not.toContain('secret')
  })

  it('throws StorybookUnreachableError when the connection drops while the body is read', async () => {
    const dir = createStorybookFolder()
    const url = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { 'Content-Length': '1000' })
        response.write('{"entries"')
        setTimeout(() => {
          response.destroy()
        }, 20)
      }),
    )

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookUnreachableError)
    expect((error as Error).message).toContain(`Storybook web stopped answering at ${url}/index.json (`)
    expect((error as Error).message).toContain('Start it again, then rerun.')
  })

  it('throws StorybookUnreachableError naming the Storybook and the index URL when nothing answers', async () => {
    const dir = createStorybookFolder()
    const url = await takeUnusedUrl()

    const error = await readStories({ name: 'web', url, dir }, dir).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookUnreachableError)
    expect((error as Error).message).toBe(
      `Storybook web doesn't answer at ${url}/index.json (ECONNREFUSED). ` +
        'Start it, or set its URL in the config or with --url.',
    )
  })

  it('throws StorybookUnreachableError when the server accepts the request and never answers', async () => {
    const dir = createStorybookFolder()
    const url = await listen(createServer(() => undefined))

    const error = await readStories({ name: 'web', url, dir }, dir, 100).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StorybookUnreachableError)
    expect((error as Error).message).toBe(
      `Storybook web didn't answer at ${url}/index.json within 0.1 s. ` +
        "Check what's listening there, or restart Storybook.",
    )
  })
})
