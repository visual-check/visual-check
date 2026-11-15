import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaselineError } from './baseline-error.js'
import {
  baselineFileNameOf,
  baselinePathOf,
  baselineStemOf,
  readBaseline,
  snapshotKeyOf,
  writeBaseline,
} from './baseline-files.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes an empty temporary folder and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-baselines-')))

  temporaryFolders.push(folder)

  return folder
}

/**
 * Bytes that start like a PNG, as a stand-in for a snapshot.
 */
const snapshot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('snapshotKeyOf', () => {
  it('keys the default capture by the story ID alone', () => {
    expect(snapshotKeyOf('components-button--primary')).toBe('components-button--primary')
  })

  it('keys a mode by the story ID, a dot and the mode', () => {
    expect(snapshotKeyOf('components-button--primary', 'dark')).toBe('components-button--primary.dark')
  })
})

/**
 * Gives the first 16 hex characters of the key's SHA-256, over its UTF-8 bytes, which a shortened name ends with.
 */
function hashOf(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Gives the length of the text in UTF-8 bytes.
 */
function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

describe('baselineStemOf', () => {
  it('keeps a key of up to 240 bytes as it is', () => {
    expect(baselineStemOf('components-button--primary.dark')).toBe('components-button--primary.dark')
    expect(baselineStemOf('a'.repeat(240))).toBe('a'.repeat(240))
  })

  it("shortens a longer key to its first 223 bytes, -, and 16 hex characters of the full key's SHA-256", () => {
    const key = 'a'.repeat(241)

    expect(baselineStemOf(key)).toBe(`${'a'.repeat(223)}-${hashOf(key)}`)
    expect(bytesOf(baselineStemOf(key))).toBe(240)
  })
})

describe('baselineFileNameOf', () => {
  it('names a short key <key>.png', () => {
    expect(baselineFileNameOf('components-button--primary.dark')).toBe('components-button--primary.dark.png')
  })

  it('keeps a key of exactly 240 bytes as it is', () => {
    const key = 'a'.repeat(240)

    expect(baselineFileNameOf(key)).toBe(`${key}.png`)
  })

  it("shortens a key of 241 bytes to its first 223 bytes, -, and 16 hex characters of the full key's SHA-256", () => {
    const key = `${'a'.repeat(223)}${'b'.repeat(18)}`

    expect(baselineFileNameOf(key)).toBe(`${'a'.repeat(223)}-${hashOf(key)}.png`)
    expect(baselineFileNameOf(key)).toMatch(/^a{223}-[0-9a-f]{16}\.png$/)
  })

  it('never splits a character of two bytes', () => {
    const key = '\u00e9'.repeat(121)
    const name = baselineFileNameOf(key)

    expect(name).toBe(`${'\u00e9'.repeat(111)}-${hashOf(key)}.png`)
    expect(bytesOf('\u00e9'.repeat(111))).toBe(222)
  })

  it('never splits a surrogate pair', () => {
    const key = '\u{1f600}'.repeat(61)

    expect(baselineFileNameOf(key)).toBe(`${'\u{1f600}'.repeat(55)}-${hashOf(key)}.png`)
  })

  it('keeps a character that ends exactly at 223 bytes', () => {
    const key = `a${'\u00e9'.repeat(120)}`

    expect(baselineFileNameOf(key)).toBe(`a${'\u00e9'.repeat(111)}-${hashOf(key)}.png`)
  })

  it("keeps every name, with the report's longest image suffix, within 255 bytes", () => {
    const keys = [
      'a'.repeat(241),
      'a'.repeat(1000),
      '\u00e9'.repeat(500),
      '\u{1f600}'.repeat(300),
      `a${'\u00e9'.repeat(120)}`,
    ]

    for (const key of keys) {
      const name = baselineFileNameOf(key)

      expect(bytesOf(name)).toBeLessThanOrEqual(255)
      expect(bytesOf(`${baselineStemOf(key)}.snapshot.png`)).toBeLessThanOrEqual(255)
    }
  })

  it('gives two long keys that share their first 223 bytes names of their own', () => {
    const start = 'a'.repeat(223)

    expect(baselineFileNameOf(`${start}${'b'.repeat(30)}`)).not.toBe(baselineFileNameOf(`${start}${'c'.repeat(30)}`))
  })
})

describe('baselinePathOf', () => {
  it("names the default capture's baseline after its key, the story ID, in the baselines folder", () => {
    expect(baselinePathOf('/project/.visual-check/baselines', 'components-button--primary')).toBe(
      join('/project/.visual-check/baselines', 'components-button--primary.png'),
    )
  })

  it("names a mode's baseline after its key, in the baselines folder", () => {
    expect(baselinePathOf('/project/.visual-check/baselines', 'components-button--primary.dark')).toBe(
      join('/project/.visual-check/baselines', 'components-button--primary.dark.png'),
    )
  })
  it("names a long key's baseline by its shortened name", () => {
    const key = 'a'.repeat(300)

    expect(baselinePathOf('/project/.visual-check/baselines', key)).toBe(
      join('/project/.visual-check/baselines', `${'a'.repeat(223)}-${hashOf(key)}.png`),
    )
  })
})

describe('readBaseline', () => {
  it('reads the bytes of a baseline exactly', async () => {
    const path = join(createFolder(), 'button--primary.png')

    writeFileSync(path, snapshot)

    expect(new Uint8Array((await readBaseline(path)) ?? [])).toEqual(snapshot)
  })

  it('gives undefined for a baseline that is missing', async () => {
    expect(await readBaseline(join(createFolder(), 'button--primary.png'))).toBeUndefined()
  })

  it('gives undefined when the baselines folder is missing too', async () => {
    expect(await readBaseline(join(createFolder(), 'baselines', 'button--primary.png'))).toBeUndefined()
  })

  it("throws a BaselineError with the path and the system's reason when the baseline is there but can't be read", async () => {
    const path = join(createFolder(), 'button--primary.png')

    mkdirSync(path)

    const error = await readBaseline(path).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BaselineError)
    expect(error).toMatchObject({
      action: 'read',
      path,
      reason: 'EISDIR: illegal operation on a directory',
      message: `Couldn't read the baseline ${path}: EISDIR: illegal operation on a directory.`,
    })
  })

  it("throws a BaselineError when the path can't be followed, which isn't a missing baseline", async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'baselines'), '')

    await expect(readBaseline(join(folder, 'baselines', 'button--primary.png'))).rejects.toMatchObject({
      action: 'read',
      reason: 'ENOTDIR: not a directory',
    })
  })
})

describe('writeBaseline', () => {
  it('creates the baselines folder and writes the bytes exactly', async () => {
    const folder = join(createFolder(), '.visual-check', 'baselines')
    const path = join(folder, 'button--primary.png')

    await writeBaseline(path, snapshot)

    expect(new Uint8Array(readFileSync(path))).toEqual(snapshot)
    expect(readdirSync(folder)).toEqual(['button--primary.png'])
  })

  it('replaces a baseline that is there, leaving no temporary file', async () => {
    const folder = createFolder()
    const path = join(folder, 'button--primary.png')

    writeFileSync(path, 'old')
    await writeBaseline(path, snapshot)

    expect(new Uint8Array(readFileSync(path))).toEqual(snapshot)
    expect(readdirSync(folder)).toEqual(['button--primary.png'])
  })

  it('writes a baseline whose name is near the 255 bytes a file name can take', async () => {
    const folder = createFolder()
    const name = baselineFileNameOf('a'.repeat(300))

    await writeBaseline(join(folder, name), snapshot)

    expect(readdirSync(folder)).toEqual([name])
  })

  it('writes only the bytes of a view, not the rest of its buffer', async () => {
    const path = join(createFolder(), 'button--primary.png')

    await writeBaseline(path, snapshot.subarray(2, 6))

    expect(new Uint8Array(readFileSync(path))).toEqual(snapshot.subarray(2, 6))
  })

  it('removes its temporary file and keeps what was there when the baseline cannot be replaced', async () => {
    const folder = createFolder()
    const path = join(folder, 'button--primary.png')

    mkdirSync(path)
    writeFileSync(join(path, 'kept'), 'kept')

    const error = await writeBaseline(path, snapshot).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BaselineError)
    expect(error).toMatchObject({ action: 'write', path })
    expect(readdirSync(folder)).toEqual(['button--primary.png'])
    expect(readdirSync(path)).toEqual(['kept'])
  })

  it("throws a BaselineError when the baselines folder can't be made", async () => {
    const folder = createFolder()
    const path = join(folder, 'baselines', 'button--primary.png')

    writeFileSync(join(folder, 'baselines'), '')

    await expect(writeBaseline(path, snapshot)).rejects.toMatchObject({ action: 'write', path })
    expect(readdirSync(folder)).toEqual(['baselines'])
  })
})
