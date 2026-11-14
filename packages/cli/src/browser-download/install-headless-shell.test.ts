import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest'
import { BrowserDownloadError } from './browser-download-error.js'
import {
  checksumMismatchOf,
  downloadUrlOf,
  type InstallHeadlessShellOptions,
  installHeadlessShell,
  unzipFailureOf,
} from './install-headless-shell.js'

// The fixture zips are described in unzip.test.ts. chrome-headless-shell-win64.zip is `zip -X -r` of
// chrome-headless-shell-win64/, holding chrome-headless-shell.exe.

/**
 * The Chromium version the tests install.
 */
const version = '157.0.8103.78'

/**
 * The line a run prints while another run downloads.
 */
const waitingLine = `Waiting for another visual-check run to download Chromium ${version}…\n`

/**
 * The fix the messages give for a cache folder visual-check can't write to.
 */
const moveCacheFix = 'Set VISUAL_CHECK_CACHE_DIR to move it to a folder visual-check can write to.'

/**
 * What the executable holds when the test plays another run that installed it.
 */
const installedElsewhere = 'installed by another run'

/**
 * The bytes of a fixture zip.
 */
function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)))
}

/**
 * The linux64 headless shell zip the mirror serves.
 */
const linuxZip = fixture('chrome-headless-shell-linux64.zip')

/**
 * The SHA-256 of the bytes as lowercase hex.
 */
function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The test mirror: its URLs, and the paths it was asked for.
 */
interface Mirror {
  /**
   * The origin, `http://127.0.0.1:<port>`.
   */
  origin: string
  /**
   * The base URL, `<origin>/cft`, which `VISUAL_CHECK_CHROMIUM_MIRROR` holds.
   */
  base: string
  /**
   * The path of each request, in order.
   */
  requests: string[]
}

/**
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

/**
 * The folder each test works in, removed after it.
 */
let folder = ''

/**
 * The cache folder, which `VISUAL_CHECK_CACHE_DIR` holds.
 */
let cache = ''

/**
 * Each line of progress, in order.
 */
let output: string[] = []

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'visual-check-install-'))
  cache = join(folder, 'cache')
  output = []
})

afterEach(async () => {
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
  rmSync(folder, { recursive: true, force: true })
})

/**
 * Starts a mirror on a free port of 127.0.0.1 that serves each body at its path and answers 404 to anything else. It
 * answers once `beforeAnswer`, when given, has run.
 */
async function startMirror(bodies: Record<string, Buffer>, beforeAnswer?: () => void | Promise<void>): Promise<Mirror> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    const path = request.url ?? ''

    requests.push(path)
    void (async () => {
      await beforeAnswer?.()
      const body = bodies[path]

      if (body === undefined) {
        response.writeHead(404).end()

        return
      }

      response.writeHead(200, { 'content-length': body.length }).end(body)
    })()
  })

  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return { origin, base: `${origin}/cft`, requests }
}

/**
 * The path a mirror serves the platform's zip at.
 */
function zipPathOf(platform: string): string {
  return `/cft/${version}/${platform}/chrome-headless-shell-${platform}.zip`
}

/**
 * Starts a mirror serving the linux64 zip, answering once `beforeAnswer`, when given, has run.
 */
async function startLinuxMirror(beforeAnswer?: () => void | Promise<void>): Promise<Mirror> {
  return startMirror({ [zipPathOf('linux64')]: linuxZip }, beforeAnswer)
}

/**
 * The version folder in the test cache.
 */
function versionFolder(): string {
  return join(cache, 'chromium', version)
}

/**
 * The linux64 shell folder in the test cache.
 */
function shellFolder(): string {
  return join(versionFolder(), 'chrome-headless-shell-linux64')
}

/**
 * The linux64 completion marker in the test cache.
 */
function marker(): string {
  return join(versionFolder(), 'chrome-headless-shell-linux64.done')
}

/**
 * The linux64 lock folder in the test cache.
 */
function lock(): string {
  return join(versionFolder(), 'chrome-headless-shell-linux64.lock')
}

/**
 * Plays another run that installed the linux64 headless shell: its shell folder, and its marker when `withMarker`.
 */
function installElsewhere(withMarker: boolean): void {
  mkdirSync(shellFolder(), { recursive: true })
  writeFileSync(join(shellFolder(), 'chrome-headless-shell'), installedElsewhere)

  if (withMarker) {
    writeFileSync(marker(), '')
  }
}

/**
 * Makes the lock folder as another run would, changed `secondsAgo` seconds ago, with the owner file when given.
 */
function makeLock(secondsAgo: number, owner?: object): void {
  const time = new Date(Date.now() - secondsAgo * 1000)

  mkdirSync(lock(), { recursive: true })

  if (owner !== undefined) {
    writeFileSync(join(lock(), 'owner.json'), JSON.stringify(owner))
  }

  utimesSync(lock(), time, time)
}

/**
 * The process ID of a process that has exited.
 */
function exitedPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid ?? 0
}

/**
 * This process's Linux PID namespace, as the owner file names it, or `undefined` where there's none.
 */
function pidNamespace(): string | undefined {
  try {
    return readlinkSync('/proc/self/ns/pid')
  } catch {
    return undefined
  }
}

/**
 * The options that install the linux64 headless shell from the mirror into the test cache, with progress kept in
 * `output`, changed by `overrides`.
 */
function optionsFor(mirror: Mirror, overrides: Partial<InstallHeadlessShellOptions> = {}): InstallHeadlessShellOptions {
  return {
    version,
    platform: 'linux64',
    sha256: sha256Of(linuxZip),
    packageVersion: '157.0.0',
    // The trailing slash checks the mirror's base is trimmed.
    environment: { VISUAL_CHECK_CACHE_DIR: cache, VISUAL_CHECK_CHROMIUM_MIRROR: `${mirror.base}/` },
    progress: (text) => {
      output.push(text)
    },
    ...overrides,
  }
}

/**
 * The message the install fails with, or `''` when it succeeds. Checks the error is a `BrowserDownloadError`.
 */
async function failureOf(options: InstallHeadlessShellOptions): Promise<string> {
  try {
    await installHeadlessShell(options)

    return ''
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserDownloadError)

    return (error as Error).message
  }
}

describe('installHeadlessShell', () => {
  it('downloads, checks and caches the headless shell on the first run', async () => {
    const mirror = await startLinuxMirror()
    const executable = await installHeadlessShell(optionsFor(mirror))

    expect(mirror.requests).toEqual([zipPathOf('linux64')])
    expect(executable).toBe(join(shellFolder(), 'chrome-headless-shell'))
    expect(readFileSync(executable, 'utf8')).toBe('#!/bin/sh\necho chrome-headless-shell\n')
    expect(readFileSync(marker(), 'utf8')).toBe('')
    expect(readdirSync(versionFolder()).sort()).toEqual([
      'chrome-headless-shell-linux64',
      'chrome-headless-shell-linux64.done',
    ])
    expect(output[0]).toBe(`Downloading Chromium ${version} (linux64) from ${mirror.origin}${zipPathOf('linux64')}\n`)
    expect(output.at(-1)).toBe(`Chromium ${version} is in ${versionFolder()}\n`)
  })

  it.skipIf(process.platform === 'win32')('keeps the executable executable', async () => {
    const executable = await installHeadlessShell(optionsFor(await startLinuxMirror()))

    expect(statSync(executable).mode & 0o111).not.toBe(0)
  })

  it('reuses the cache on the next run, with no request and no output', async () => {
    const mirror = await startLinuxMirror()
    const first = await installHeadlessShell(optionsFor(mirror))

    output = []

    expect(await installHeadlessShell(optionsFor(mirror))).toBe(first)
    expect(mirror.requests).toHaveLength(1)
    expect(output).toEqual([])
  })

  it('downloads once when two runs start on a cold cache', async () => {
    let openGate = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    // The mirror answers once a run waits, so one run surely holds the lock while the other finds it.
    const mirror = await startLinuxMirror(() => gate)
    const progress = (text: string): void => {
      output.push(text)

      if (text === waitingLine) {
        openGate()
      }
    }

    const [first, second] = await Promise.all([
      installHeadlessShell(optionsFor(mirror, { progress })),
      installHeadlessShell(optionsFor(mirror, { progress })),
    ])

    expect(mirror.requests).toHaveLength(1)
    expect(first).toBe(join(shellFolder(), 'chrome-headless-shell'))
    expect(second).toBe(first)
    expect(output.filter((text) => text === waitingLine)).toHaveLength(1)
  })

  it.each([
    ['with', true],
    ['without', false],
  ])('keeps what another run holding the lock too installed meanwhile, %s its marker', async (_, withMarker) => {
    const mirror = await startLinuxMirror(() => {
      installElsewhere(withMarker)
    })
    const executable = await installHeadlessShell(optionsFor(mirror))

    expect(mirror.requests).toHaveLength(1)
    expect(readFileSync(executable, 'utf8')).toBe(installedElsewhere)
    expect(readdirSync(versionFolder()).sort()).toEqual([
      'chrome-headless-shell-linux64',
      'chrome-headless-shell-linux64.done',
    ])
  })

  it('fails on a download with the wrong SHA-256, leaving nothing behind', async () => {
    const mirror = await startLinuxMirror()
    const wrong = 'f'.repeat(64)

    expect(await failureOf(optionsFor(mirror, { sha256: wrong }))).toBe(
      `The download of Chromium ${version} (linux64) from ${mirror.origin}${zipPathOf('linux64')} ` +
        `has SHA-256 ${sha256Of(linuxZip)}, but the browser package @visual-check/chromium 157.0.0 expects ${wrong}. ` +
        "Check that VISUAL_CHECK_CHROMIUM_MIRROR serves Chrome for Testing's files unchanged.",
    )
    expect(readdirSync(versionFolder())).toEqual([])

    // The lock was released, so the next run downloads.
    await installHeadlessShell(optionsFor(mirror))

    expect(mirror.requests).toHaveLength(2)
  })

  it('fails on a zip without the executable, leaving nothing behind', async () => {
    const windowsZip = fixture('chrome-headless-shell-win64.zip')
    const mirror = await startMirror({ [zipPathOf('linux64')]: windowsZip })

    expect(await failureOf(optionsFor(mirror, { sha256: sha256Of(windowsZip) }))).toBe(
      `The download of Chromium ${version} (linux64) from ${mirror.origin}${zipPathOf('linux64')} ` +
        'has no chrome-headless-shell-linux64/chrome-headless-shell. ' +
        'Report it at https://github.com/visual-check/visual-check/issues.',
    )
    expect(readdirSync(versionFolder())).toEqual([])
  })

  it('names the cache folder when the download, with the right SHA-256, cannot be unzipped', async () => {
    const notZip = Buffer.from('Not a zip.\n')
    const mirror = await startMirror({ [zipPathOf('linux64')]: notZip })

    expect(await failureOf(optionsFor(mirror, { sha256: sha256Of(notZip) }))).toBe(
      `Couldn't unzip Chromium ${version} (linux64) into ${versionFolder()}: ` +
        'End of central directory record signature not found. Either not a zip file, or file is truncated. ' +
        'Report it at https://github.com/visual-check/visual-check/issues.',
    )
    expect(readdirSync(versionFolder())).toEqual([])
  })

  it('fails when the download fails, leaving nothing behind', async () => {
    const mirror = await startMirror({})

    expect(await failureOf(optionsFor(mirror))).toBe(
      `The download of Chromium ${version} (linux64) from ${mirror.origin}${zipPathOf('linux64')} ` +
        'failed with HTTP 404.',
    )
    expect(readdirSync(versionFolder())).toEqual([])
  })

  it('gives no cache fix when the network fails, though its error names the call that failed', async () => {
    const mirror = await startLinuxMirror()
    const server = servers.pop()

    assert.isDefined(server)
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })

    expect(await failureOf(optionsFor(mirror))).toBe(
      `The download of Chromium ${version} (linux64) from ${mirror.origin}${zipPathOf('linux64')} ` +
        `failed: connect ECONNREFUSED ${mirror.origin.replace('http://', '')}.`,
    )
  })

  it.each([
    ['last changed a minute ago', 60],
    ['changed a minute ahead, by another clock', -60],
  ])('takes over a stale lock, %s', async (_, secondsAgo) => {
    const mirror = await startLinuxMirror()

    makeLock(secondsAgo)

    expect(existsSync(await installHeadlessShell(optionsFor(mirror)))).toBe(true)
    expect(mirror.requests).toHaveLength(1)
    expect(output).not.toContain(waitingLine)
    expect(existsSync(lock())).toBe(false)
  })

  it('takes over at once a lock whose run exited on this machine, removing its temporary files', async () => {
    const mirror = await startLinuxMirror()
    const token = '0123456789abcdef'
    const otherToken = 'fedcba9876543210'

    makeLock(0, { pid: exitedPid(), hostname: hostname(), token, pidNamespace: pidNamespace() })
    writeFileSync(join(versionFolder(), `.download-${token}.zip`), 'half')
    mkdirSync(join(versionFolder(), `.extract-${token}`))
    // Another run's, which isn't old enough to be removed.
    writeFileSync(join(versionFolder(), `.download-${otherToken}.zip`), 'half')

    expect(existsSync(await installHeadlessShell(optionsFor(mirror)))).toBe(true)
    expect(output).not.toContain(waitingLine)
    expect(readdirSync(versionFolder()).sort()).toEqual([
      `.download-${otherToken}.zip`,
      'chrome-headless-shell-linux64',
      'chrome-headless-shell-linux64.done',
    ])
  })

  it.each([
    ['whose run is alive on this machine', { pid: process.pid, hostname: hostname(), token: '0123456789abcdef' }],
    ['whose run is on another machine', { pid: exitedPid(), hostname: 'another-machine', token: '0123456789abcdef' }],
    [
      'whose run is in another PID namespace, as in another container',
      { pid: exitedPid(), hostname: hostname(), token: '0123456789abcdef', pidNamespace: 'pid:[1]' },
    ],
    ['with no owner file yet', undefined],
  ])('waits for a lock %s, then uses what that run installed', async (_, owner) => {
    const mirror = await startLinuxMirror()
    const progress = (text: string): void => {
      output.push(text)

      if (text === waitingLine) {
        installElsewhere(true)
      }
    }

    makeLock(0, owner)

    const executable = await installHeadlessShell(optionsFor(mirror, { progress }))

    expect(readFileSync(executable, 'utf8')).toBe(installedElsewhere)
    expect(mirror.requests).toEqual([])
    expect(output).toEqual([waitingLine])
  })

  it('removes the temporary files runs left more than 30 s ago, and keeps newer ones', async () => {
    const mirror = await startLinuxMirror()
    const minuteAgo = new Date(Date.now() - 60_000)
    const oldZip = join(versionFolder(), '.download-0123456789abcdef.zip')
    const oldExtraction = join(versionFolder(), '.extract-0123456789abcdef')

    mkdirSync(oldExtraction, { recursive: true })
    writeFileSync(oldZip, 'half')
    writeFileSync(join(versionFolder(), '.download-fedcba9876543210.zip'), 'half')
    utimesSync(oldZip, minuteAgo, minuteAgo)
    utimesSync(oldExtraction, minuteAgo, minuteAgo)

    await installHeadlessShell(optionsFor(mirror))

    expect(readdirSync(versionFolder()).sort()).toEqual([
      '.download-fedcba9876543210.zip',
      'chrome-headless-shell-linux64',
      'chrome-headless-shell-linux64.done',
    ])
  })

  it('replaces a shell folder without the executable, left by a run that died', async () => {
    const mirror = await startLinuxMirror()

    mkdirSync(shellFolder(), { recursive: true })
    writeFileSync(join(shellFolder(), 'leftover'), 'leftover')

    const executable = await installHeadlessShell(optionsFor(mirror))

    expect(mirror.requests).toHaveLength(1)
    expect(readFileSync(executable, 'utf8')).toBe('#!/bin/sh\necho chrome-headless-shell\n')
    expect(existsSync(join(shellFolder(), 'leftover'))).toBe(false)
  })

  it('downloads again when the marker is there but the executable is not', async () => {
    const mirror = await startLinuxMirror()

    mkdirSync(versionFolder(), { recursive: true })
    writeFileSync(marker(), '')

    expect(existsSync(await installHeadlessShell(optionsFor(mirror)))).toBe(true)
    expect(mirror.requests).toHaveLength(1)
  })

  it('leaves other versions alone', async () => {
    const mirror = await startLinuxMirror()
    const otherFolder = join(cache, 'chromium', '156.0.7000.0')
    const otherExecutable = join(otherFolder, 'chrome-headless-shell-linux64', 'chrome-headless-shell')

    mkdirSync(join(otherFolder, 'chrome-headless-shell-linux64'), { recursive: true })
    writeFileSync(otherExecutable, 'older')
    writeFileSync(join(otherFolder, 'chrome-headless-shell-linux64.done'), '')

    await installHeadlessShell(optionsFor(mirror))

    expect(readFileSync(otherExecutable, 'utf8')).toBe('older')
    expect(readdirSync(join(cache, 'chromium')).sort()).toEqual(['156.0.7000.0', version])
  })

  it('gives the .exe on Windows', async () => {
    const windowsZip = fixture('chrome-headless-shell-win64.zip')
    const mirror = await startMirror({ [zipPathOf('win64')]: windowsZip })
    const executable = await installHeadlessShell(
      optionsFor(mirror, { platform: 'win64', sha256: sha256Of(windowsZip) }),
    )

    expect(mirror.requests).toEqual([zipPathOf('win64')])
    expect(executable).toBe(join(versionFolder(), 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))
    expect(existsSync(executable)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('uses the OS cache folder without VISUAL_CHECK_CACHE_DIR', async () => {
    const mirror = await startLinuxMirror()
    const home = join(folder, 'home')
    const executable = await installHeadlessShell(
      optionsFor(mirror, {
        environment: { VISUAL_CHECK_CHROMIUM_MIRROR: mirror.base },
        os: 'linux',
        homeDir: home,
      }),
    )

    expect(executable).toBe(
      join(
        home,
        '.cache',
        'visual-check',
        'chromium',
        version,
        'chrome-headless-shell-linux64',
        'chrome-headless-shell',
      ),
    )
    expect(existsSync(executable)).toBe(true)
  })

  it('says how to move the cache when its folder cannot be made', async () => {
    const mirror = await startLinuxMirror()

    writeFileSync(cache, 'a file, not a folder')

    const message = await failureOf(optionsFor(mirror))

    expect(message).toMatch(/^Couldn't make the folder .+ to download Chromium into: .+\. /)
    expect(message.endsWith(` ${moveCacheFix}`)).toBe(true)
    expect(mirror.requests).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'says how to move the cache when it cannot be written',
    async () => {
      const mirror = await startLinuxMirror()

      mkdirSync(versionFolder(), { recursive: true })
      chmodSync(versionFolder(), 0o555)

      try {
        expect(await failureOf(optionsFor(mirror))).toBe(
          `Couldn't install Chromium ${version} in ${versionFolder()}: ` +
            `EACCES: permission denied, mkdir '${lock()}'. ${moveCacheFix}`,
        )
      } finally {
        chmodSync(versionFolder(), 0o755)
      }
    },
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'says how to move the cache when the download cannot be written to it',
    async () => {
      // The version folder turns read-only once this run holds the lock, before the zip is written.
      const mirror = await startLinuxMirror(() => {
        chmodSync(versionFolder(), 0o555)
      })

      try {
        const message = await failureOf(optionsFor(mirror))

        expect(
          message.startsWith(
            `Couldn't install Chromium ${version} in ${versionFolder()}: ` +
              `EACCES: permission denied, open '${join(versionFolder(), '.download-')}`,
          ),
        ).toBe(true)
        expect(message.endsWith(` ${moveCacheFix}`)).toBe(true)
      } finally {
        chmodSync(versionFolder(), 0o755)
      }
    },
  )

  it('fails on a mirror that is not an http or https URL, before touching the cache', async () => {
    const mirror = await startLinuxMirror()
    const options = optionsFor(mirror, {
      environment: { VISUAL_CHECK_CACHE_DIR: cache, VISUAL_CHECK_CHROMIUM_MIRROR: 'ftp://mirror.example.com' },
    })

    expect(await failureOf(options)).toMatch(/^VISUAL_CHECK_CHROMIUM_MIRROR must be an http:\/\/ or https:\/\/ URL/)
    expect(existsSync(cache)).toBe(false)
  })
})

describe('downloadUrlOf', () => {
  it("gives Chrome for Testing's URL without a mirror", () => {
    const base = `https://storage.googleapis.com/chrome-for-testing-public/${version}`

    expect(downloadUrlOf({}, version, 'mac-arm64').href).toBe(`${base}/mac-arm64/chrome-headless-shell-mac-arm64.zip`)
    expect(downloadUrlOf({ VISUAL_CHECK_CHROMIUM_MIRROR: '' }, version, 'win64').href).toBe(
      `${base}/win64/chrome-headless-shell-win64.zip`,
    )
  })

  it('gives the same path on the mirror, its trailing slashes trimmed', () => {
    expect(
      downloadUrlOf({ VISUAL_CHECK_CHROMIUM_MIRROR: 'https://mirror.example.com/cft//' }, version, 'linux64').href,
    ).toBe(`https://mirror.example.com/cft/${version}/linux64/chrome-headless-shell-linux64.zip`)
  })

  it('fails on a mirror that is not a URL, without printing it', () => {
    expect(() => downloadUrlOf({ VISUAL_CHECK_CHROMIUM_MIRROR: 'secret mirror' }, version, 'linux64')).toThrow(
      new BrowserDownloadError(
        'VISUAL_CHECK_CHROMIUM_MIRROR must be an http:// or https:// URL, ' +
          'such as https://mirror.example.com/chrome-for-testing-public.',
      ),
    )
  })
})

describe('unzipFailureOf', () => {
  /**
   * What the download is called in these tests.
   */
  const label = `Chromium ${version} (linux64)`

  /**
   * The version folder in these tests.
   */
  const folderName = `/cache/chromium/${version}`

  it('says to move the cache when the file system refused, naming the call that failed', () => {
    const error = Object.assign(new Error('ENOSPC: no space left on device, write'), {
      code: 'ENOSPC',
      syscall: 'write',
    })

    expect(unzipFailureOf(label, folderName, error)).toBe(
      `Couldn't unzip ${label} into ${folderName}: ENOSPC: no space left on device, write. ${moveCacheFix}`,
    )
  })

  it('says to report any other error, such as a damaged zip', () => {
    const error = Object.assign(new Error('invalid block type'), { code: 'Z_DATA_ERROR', errno: -3 })

    expect(unzipFailureOf(label, folderName, error)).toBe(
      `Couldn't unzip ${label} into ${folderName}: invalid block type. ` +
        'Report it at https://github.com/visual-check/visual-check/issues.',
    )
  })
})

describe('checksumMismatchOf', () => {
  /**
   * The SHA-256 the browser package expects in these tests.
   */
  const expected = 'a'.repeat(64)

  /**
   * The SHA-256 the download has in these tests.
   */
  const actual = 'b'.repeat(64)

  /**
   * The URL the download came from in these tests, with credentials that must not be printed.
   */
  const url = new URL(`https://user:secret@storage.googleapis.com/cft/${version}/linux64/x.zip`)

  /**
   * The mismatch message for the environment, up to its fix.
   */
  function mismatchFor(environment: Record<string, string | undefined>): string {
    return checksumMismatchOf(
      {
        version,
        platform: 'linux64',
        sha256: expected,
        packageVersion: '157.0.1',
        environment,
        progress: () => undefined,
      },
      url,
      actual,
    )
  }

  /**
   * What every mismatch message starts with.
   */
  const start =
    `The download of Chromium ${version} (linux64) from https://storage.googleapis.com/cft/${version}/linux64/x.zip ` +
    `has SHA-256 ${actual}, but the browser package @visual-check/chromium 157.0.1 expects ${expected}. `

  it('says to check the mirror when there is one', () => {
    expect(mismatchFor({ VISUAL_CHECK_CHROMIUM_MIRROR: 'https://mirror.example.com' })).toBe(
      `${start}Check that VISUAL_CHECK_CHROMIUM_MIRROR serves Chrome for Testing's files unchanged.`,
    )
  })

  it('says to check the proxy when there is one, printing no credentials', () => {
    expect(mismatchFor({ HTTPS_PROXY: 'http://user:secret@proxy.example.com:3128' })).toBe(
      `${start}The proxy http://proxy.example.com:3128 may have changed it: ` +
        'check that it lets storage.googleapis.com through unchanged, then run visual-check again.',
    )
  })

  it('says to run again and report it without a mirror or a proxy', () => {
    expect(mismatchFor({})).toBe(
      `${start}Run visual-check again, and if it happens again, ` +
        'report it at https://github.com/visual-check/visual-check/issues.',
    )
  })
})
