import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaselineError } from './baseline-error.js'
import { baselinePathOf, isByteIdentical, readBaseline, writeBaseline } from './baseline-files.js'

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

describe('baselinePathOf', () => {
  it("names the default capture's baseline after the story ID, in the baselines folder", () => {
    expect(baselinePathOf('/project/.visual-check/baselines', 'components-button--primary')).toBe(
      join('/project/.visual-check/baselines', 'components-button--primary.png'),
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

describe('isByteIdentical', () => {
  it('is true for the same bytes', () => {
    expect(isByteIdentical(snapshot, new Uint8Array(snapshot))).toBe(true)
  })

  it('is true for two empty images', () => {
    expect(isByteIdentical(new Uint8Array(), new Uint8Array())).toBe(true)
  })

  it('is false when one byte differs', () => {
    const changed = new Uint8Array(snapshot)

    changed[9] = 0xfe

    expect(isByteIdentical(snapshot, changed)).toBe(false)
  })

  it('is false when one is a prefix of the other', () => {
    expect(isByteIdentical(snapshot, snapshot.subarray(0, 9))).toBe(false)
    expect(isByteIdentical(snapshot.subarray(0, 9), snapshot)).toBe(false)
  })

  it('compares only the bytes of a view, not the rest of its buffer', () => {
    expect(isByteIdentical(snapshot.subarray(2, 6), new Uint8Array([0x4e, 0x47, 0x0d, 0x0a]))).toBe(true)
  })
})
