import { createHash } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaselineError } from './baseline-error.js'
import {
  baselineFileNameOf,
  baselinePathOf,
  baselineStemOf,
  deleteOrphans,
  expectedBaselinesAt,
  foldedFileNameOf,
  hasBaseline,
  listBaselines,
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

  it('encodes an accented letter as NFC, however the key encodes it', () => {
    const composed = 'café--primary'

    expect(baselineStemOf(composed.normalize('NFD'))).toBe(composed)
  })

  it('shortens a long key the same way, however the key encodes its accented letters', () => {
    const composed = 'é'.repeat(121)

    expect(baselineStemOf(composed.normalize('NFD'))).toBe(baselineStemOf(composed))
    expect(baselineStemOf(composed)).toBe(`${'é'.repeat(111)}-${hashOf(composed)}`)
  })
})

describe('foldedFileNameOf', () => {
  it('folds case and how an accented letter is encoded', () => {
    expect(foldedFileNameOf('CAFÉ.png')).toBe(foldedFileNameOf('café.png'))
  })

  it('folds ß as SS and a final sigma as a sigma, as macOS does', () => {
    expect(foldedFileNameOf('straße.png')).toBe(foldedFileNameOf('STRASSE.png'))
    expect(foldedFileNameOf('straße.png')).toBe(foldedFileNameOf('strasse.png'))
    expect(foldedFileNameOf('ς.png')).toBe(foldedFileNameOf('σ.png'))
  })

  it('keeps names apart that differ in more than case or encoding', () => {
    expect(foldedFileNameOf('cafe.png')).not.toBe(foldedFileNameOf('café.png'))
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

describe('hasBaseline', () => {
  it('says a baseline is there', async () => {
    const path = join(createFolder(), 'button--primary.png')

    writeFileSync(path, snapshot)
    expect(await hasBaseline(path)).toBe(true)
  })

  it('says a baseline is missing, with or without its folder', async () => {
    const folder = createFolder()

    expect(await hasBaseline(join(folder, 'button--primary.png'))).toBe(false)
    expect(await hasBaseline(join(folder, 'baselines', 'button--primary.png'))).toBe(false)
  })

  it("throws a BaselineError when the path can't be followed", async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'baselines'), '')
    await expect(hasBaseline(join(folder, 'baselines', 'button--primary.png'))).rejects.toMatchObject({
      action: 'read',
      reason: 'ENOTDIR: not a directory',
    })
  })
})

describe('listBaselines', () => {
  it('lists the PNG files by name, leaving out other files, temporary files and subfolders', async () => {
    const folder = createFolder()

    for (const name of ['b.png', 'a.dark.png', 'notes.txt', '.visual-check-0a1b2c.tmp', 'upper.PNG', 'a.png']) {
      writeFileSync(join(folder, name), snapshot)
    }

    mkdirSync(join(folder, 'folder.png'))
    expect(await listBaselines(folder)).toEqual(['a.dark.png', 'a.png', 'b.png'])
  })

  it.skipIf(process.platform === 'win32')(
    'lists a link that leads to a file, leaving out a broken link and a link to a folder',
    async () => {
      const folder = createFolder()
      const elsewhere = createFolder()

      writeFileSync(join(elsewhere, 'target.png'), snapshot)
      mkdirSync(join(elsewhere, 'folder'))
      symlinkSync(join(elsewhere, 'target.png'), join(folder, 'linked.png'))
      symlinkSync(join(elsewhere, 'missing.png'), join(folder, 'broken.png'))
      symlinkSync(join(elsewhere, 'folder'), join(folder, 'folder.png'))
      symlinkSync(join(elsewhere, 'target.png'), join(folder, 'linked.txt'))
      expect(await listBaselines(folder)).toEqual(['linked.png'])
    },
  )

  it('gives no baselines for a missing folder', async () => {
    expect(await listBaselines(join(createFolder(), 'baselines'))).toEqual([])
  })

  it("throws a BaselineError naming the folder when it can't be listed", async () => {
    const folder = join(createFolder(), 'baselines')

    writeFileSync(folder, '')

    const error = await listBaselines(folder).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BaselineError)
    expect(error).toMatchObject({
      action: 'list',
      path: folder,
      reason: 'ENOTDIR: not a directory',
      message: `Couldn't list the baselines folder ${folder}: ENOTDIR: not a directory.`,
    })
  })
})

describe('expectedBaselinesAt', () => {
  it('tells which expected paths have a file, in the order given', async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'a.png'), snapshot)

    const expected = await expectedBaselinesAt([join(folder, 'missing.png'), join(folder, 'a.png')])

    expect(expected.present).toEqual([false, true])
  })

  it('gives the paths that are not expected, in the order given', async () => {
    const folder = createFolder()

    for (const name of ['a.png', 'b.png', 'c.png']) {
      writeFileSync(join(folder, name), snapshot)
    }

    const paths = [join(folder, 'c.png'), join(folder, 'a.png'), join(folder, 'b.png')]
    const expected = await expectedBaselinesAt([join(folder, 'a.png'), join(folder, 'missing.png')])

    expect(await expected.pathsNotExpected(paths)).toEqual([join(folder, 'c.png'), join(folder, 'b.png')])
  })

  it('leaves out a path that is a hard link to an expected baseline, and a path with no file', async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'a.png'), snapshot)
    linkSync(join(folder, 'a.png'), join(folder, 'other-name.png'))

    const expected = await expectedBaselinesAt([join(folder, 'a.png')])

    expect(await expected.pathsNotExpected([join(folder, 'other-name.png'), join(folder, 'gone.png')])).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin')(
    "leaves out a path the file system takes for an expected baseline, as macOS does for 'ς' and 'σ'",
    async (context) => {
      const folder = createFolder()

      writeFileSync(join(folder, 'ς.png'), snapshot)

      if (!existsSync(join(folder, 'σ.png'))) {
        context.skip('This folder is on a file system that tells the two names apart.')
      }

      const expected = await expectedBaselinesAt([join(folder, 'σ.png')])

      expect(expected.present).toEqual([true])
      expect(await expected.pathsNotExpected([join(folder, 'ς.png')])).toEqual([])
    },
  )
})

describe('deleteOrphans', () => {
  it('deletes the orphans in the order given and nothing else, giving their paths', async () => {
    const folder = createFolder()

    for (const name of ['a.png', 'b.png', 'c.png']) {
      writeFileSync(join(folder, name), snapshot)
    }

    const orphans = [join(folder, 'c.png'), join(folder, 'a.png')]

    expect(await deleteOrphans(orphans, [join(folder, 'b.png'), join(folder, 'missing.png')])).toEqual(orphans)
    expect(readdirSync(folder)).toEqual(['b.png'])
  })

  it('leaves out an orphan that is already gone', async () => {
    const folder = createFolder()

    expect(await deleteOrphans([join(folder, 'gone.png')], [])).toEqual([])
  })

  it('keeps an orphan that is another name of an expected baseline', async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'a.png'), snapshot)
    linkSync(join(folder, 'a.png'), join(folder, 'other-name.png'))

    expect(await deleteOrphans([join(folder, 'other-name.png')], [join(folder, 'a.png')])).toEqual([])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'other-name.png'])
  })

  it.skipIf(process.platform === 'win32')(
    'deletes only the link of an orphan that links to another file, and keeps one that links to an expected one',
    async () => {
      const folder = createFolder()
      const elsewhere = createFolder()

      writeFileSync(join(folder, 'a.png'), snapshot)
      writeFileSync(join(elsewhere, 'target.png'), snapshot)
      symlinkSync(join(elsewhere, 'target.png'), join(folder, 'linked.png'))
      symlinkSync(join(folder, 'a.png'), join(folder, 'to-a.png'))

      const orphans = [join(folder, 'linked.png'), join(folder, 'to-a.png')]

      expect(await deleteOrphans(orphans, [join(folder, 'a.png')])).toEqual([join(folder, 'linked.png')])
      expect(readdirSync(folder).sort()).toEqual(['a.png', 'to-a.png'])
      expect(readFileSync(join(elsewhere, 'target.png'))).toEqual(Buffer.from(snapshot))
    },
  )

  it.skipIf(process.platform !== 'darwin')(
    "keeps an orphan the file system takes for an expected baseline, as macOS does for 'ς' and 'σ'",
    async (context) => {
      const folder = createFolder()

      writeFileSync(join(folder, 'ς.png'), snapshot)

      if (!existsSync(join(folder, 'σ.png'))) {
        context.skip('This folder is on a file system that tells the two names apart.')
      }

      expect(await deleteOrphans([join(folder, 'ς.png')], [join(folder, 'σ.png')])).toEqual([])
      expect(readdirSync(folder)).toEqual(['ς.png'])
    },
  )

  it("throws a BaselineError with the path and the system's reason when an orphan can't be deleted", async () => {
    const folder = createFolder()
    const path = join(folder, 'folder.png')

    mkdirSync(path)

    const error = await deleteOrphans([path], []).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BaselineError)
    expect(error).toMatchObject({ action: 'delete', path })
    expect(existsSync(path)).toBe(true)
  })
})
