import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unzip } from './unzip.js'

// The fixtures were built once, from a folder holding the files they list:
// - chrome-headless-shell-linux64.zip: `zip -X -r` of chrome-headless-shell-linux64/, holding chrome-headless-shell
//   (a `#!/bin/sh` script, mode 0755, stored) and LICENSE.headless_shell (mode 0644, deflated).
// - symlink-inside.zip: `zip -X -r -y` of folder/, holding target.txt and link, a symlink to target.txt.
// - symlink-outside.zip: `zip -X -y` of link, a symlink to ../outside.txt.
// - The rest were written with Python's zipfile, since `zip` won't store a name with `..`, a file under a symlink, a
//   symlink to a path that isn't there, nor a Windows zip:
//   - dot-dot-name.zip holds ../escape.txt;
//   - through-symlink.zip holds folder/, link, a symlink to folder, and link/written.txt;
//   - symlink-absolute.zip holds link, a symlink to /tmp/outside.txt;
//   - symlink-backslash.zip holds link, a symlink to ..\outside.txt;
//   - dos-made.zip holds file.txt, made on MS-DOS, with the high bits of its attributes set to a symlink's mode 0755.

/**
 * The path of a fixture zip.
 */
function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

/**
 * The folder each test works in, removed after it.
 */
let folder = ''

/**
 * Where each test extracts to, inside `folder`.
 */
let destination = ''

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'visual-check-unzip-'))
  destination = join(folder, 'extracted')
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/**
 * The message the unzip fails with, or `''` when it succeeds. Checks the error is an `Error`.
 */
async function failureOf(zipPath: string): Promise<string> {
  try {
    await unzip(zipPath, destination)

    return ''
  } catch (error) {
    expect(error).toBeInstanceOf(Error)

    return (error as Error).message
  }
}

describe('unzip', () => {
  it('makes the folders and writes the files', async () => {
    await unzip(fixture('chrome-headless-shell-linux64.zip'), destination)

    const shell = join(destination, 'chrome-headless-shell-linux64')

    expect(statSync(shell).isDirectory()).toBe(true)
    expect(readFileSync(join(shell, 'chrome-headless-shell'), 'utf8')).toBe('#!/bin/sh\necho chrome-headless-shell\n')
    expect(readFileSync(join(shell, 'LICENSE.headless_shell'), 'utf8')).toContain(
      'Line 40 of a license that repeats so zip compresses it.\n',
    )
  })

  it.skipIf(process.platform === 'win32')('keeps the permissions the zip holds', async () => {
    await unzip(fixture('chrome-headless-shell-linux64.zip'), destination)

    const shell = join(destination, 'chrome-headless-shell-linux64')

    expect(statSync(join(shell, 'chrome-headless-shell')).mode & 0o111).not.toBe(0)
    expect(statSync(join(shell, 'LICENSE.headless_shell')).mode & 0o111).toBe(0)
  })

  it.skipIf(process.platform === 'win32')('makes a symlink that points inside the folder', async () => {
    await unzip(fixture('symlink-inside.zip'), destination)

    const link = join(destination, 'folder', 'link')

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe('target.txt')
    expect(readFileSync(link, 'utf8')).toBe('The target.\n')
  })

  it.each([
    ['symlink-outside.zip', '../outside.txt'],
    ['symlink-absolute.zip', '/tmp/outside.txt'],
    ['symlink-backslash.zip', '..\\outside.txt'],
  ])('refuses a symlink that could point outside the folder, from %s', async (name, target) => {
    expect(await failureOf(fixture(name))).toBe(
      `the symlink link points to ${target}, but its target must be a relative path without a .. in it`,
    )
    expect(existsSync(join(destination, 'link'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('writes a file under a symlink into its target', async () => {
    await unzip(fixture('through-symlink.zip'), destination)

    expect(readFileSync(join(destination, 'folder', 'written.txt'), 'utf8')).toBe('Through the link.\n')
  })

  it.skipIf(process.platform === 'win32')('ignores the attributes of a zip not made on Unix', async () => {
    await unzip(fixture('dos-made.zip'), destination)

    const file = join(destination, 'file.txt')

    expect(lstatSync(file).isFile()).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('Made on Windows.\n')
    expect(statSync(file).mode & 0o111).toBe(0)
  })

  it('refuses a name with .. in it', async () => {
    expect(await failureOf(fixture('dot-dot-name.zip'))).toBe('invalid relative path: ../escape.txt')
    expect(existsSync(join(folder, 'escape.txt'))).toBe(false)
  })

  it('fails on a file that is not a zip, with no call of the file system that failed', async () => {
    const zipPath = join(folder, 'not-a-zip.zip')

    writeFileSync(zipPath, 'This is not a zip.\n')

    const result = unzip(zipPath, destination)

    await expect(result).rejects.toThrow(/central directory/)
    await expect(result).rejects.not.toHaveProperty('syscall')
  })

  it('fails on a zip whose compressed data is damaged', async () => {
    const zipPath = join(folder, 'damaged.zip')
    const bytes = readFileSync(fixture('chrome-headless-shell-linux64.zip'))
    // The deflated license's data follows its name in its local header, the name's first occurrence.
    const dataStart = bytes.indexOf('LICENSE.headless_shell') + 'LICENSE.headless_shell'.length

    bytes.fill(0xff, dataStart, dataStart + 16)
    writeFileSync(zipPath, bytes)

    expect(await failureOf(zipPath)).toBe('invalid block type')
  })

  it("fails on a zip that is missing with the file system's error, which names the call that failed", async () => {
    await expect(unzip(join(folder, 'missing.zip'), destination)).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'open',
    })
  })
})
