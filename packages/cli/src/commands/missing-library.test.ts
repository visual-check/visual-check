import { describe, expect, it } from 'vitest'
import { missingLibraryOf } from './missing-library.js'

/**
 * The line Linux's dynamic loader prints when the headless shell links against a library the machine lacks.
 */
const loaderLine =
  '/home/me/.cache/visual-check/chromium/157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell: ' +
  'error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory'

describe('missingLibraryOf', () => {
  it("names the library in the dynamic loader's line", () => {
    expect(missingLibraryOf([loaderLine])).toBe('libnss3.so')
  })

  it('names a library with a version in its file name', () => {
    expect(
      missingLibraryOf([
        './chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object ' +
          'file: No such file or directory',
      ]),
    ).toBe('libatk-1.0.so.0')
  })

  it('gives undefined for output without the loader line', () => {
    expect(missingLibraryOf(['[0101/000000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!'])).toBe(
      undefined,
    )
    expect(missingLibraryOf([])).toBe(undefined)
  })

  it('finds the loader line among other lines, and names the first library', () => {
    expect(
      missingLibraryOf([
        'Fontconfig error: No writable cache directories',
        loaderLine,
        'x: error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file',
      ]),
    ).toBe('libnss3.so')
  })
})
