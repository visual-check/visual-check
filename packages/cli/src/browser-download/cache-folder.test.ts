import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cacheFolderOf } from './cache-folder.js'

describe('cacheFolderOf', () => {
  it('uses ~/.cache on Linux', () => {
    expect(cacheFolderOf({}, 'linux', '/home/ada')).toBe('/home/ada/.cache/visual-check')
  })

  it('uses XDG_CACHE_HOME on Linux when it is an absolute path', () => {
    expect(cacheFolderOf({ XDG_CACHE_HOME: '/var/cache/ada' }, 'linux', '/home/ada')).toBe(
      '/var/cache/ada/visual-check',
    )
  })

  it('ignores a relative or empty XDG_CACHE_HOME', () => {
    expect(cacheFolderOf({ XDG_CACHE_HOME: 'cache' }, 'linux', '/home/ada')).toBe('/home/ada/.cache/visual-check')
    expect(cacheFolderOf({ XDG_CACHE_HOME: '' }, 'linux', '/home/ada')).toBe('/home/ada/.cache/visual-check')
  })

  it('follows the Linux rules on other Unixes', () => {
    expect(cacheFolderOf({}, 'freebsd', '/home/ada')).toBe('/home/ada/.cache/visual-check')
    expect(cacheFolderOf({ XDG_CACHE_HOME: '/tmp/cache' }, 'freebsd', '/home/ada')).toBe('/tmp/cache/visual-check')
  })

  it('uses ~/Library/Caches on macOS, whatever XDG_CACHE_HOME says', () => {
    expect(cacheFolderOf({ XDG_CACHE_HOME: '/tmp/cache' }, 'darwin', '/Users/ada')).toBe(
      '/Users/ada/Library/Caches/visual-check',
    )
  })

  it('uses LOCALAPPDATA on Windows', () => {
    expect(cacheFolderOf({ LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' }, 'win32', 'C:\\Users\\ada')).toBe(
      'C:\\Users\\ada\\AppData\\Local\\visual-check',
    )
  })

  it('uses AppData\\Local in the home folder on Windows without LOCALAPPDATA', () => {
    expect(cacheFolderOf({}, 'win32', 'C:\\Users\\ada')).toBe('C:\\Users\\ada\\AppData\\Local\\visual-check')
    expect(cacheFolderOf({ LOCALAPPDATA: '' }, 'win32', 'C:\\Users\\ada')).toBe(
      'C:\\Users\\ada\\AppData\\Local\\visual-check',
    )
  })

  it('uses VISUAL_CHECK_CACHE_DIR as it is when it is absolute', () => {
    expect(cacheFolderOf({ VISUAL_CHECK_CACHE_DIR: '/srv/cache' }, 'linux', '/home/ada')).toBe('/srv/cache')
    expect(cacheFolderOf({ VISUAL_CHECK_CACHE_DIR: '/srv/cache/' }, 'darwin', '/Users/ada')).toBe('/srv/cache')
    expect(cacheFolderOf({ VISUAL_CHECK_CACHE_DIR: 'D:\\cache' }, 'win32', 'C:\\Users\\ada')).toBe('D:\\cache')
  })

  it.skipIf(process.platform === 'win32')('resolves a relative VISUAL_CHECK_CACHE_DIR from the working folder', () => {
    expect(cacheFolderOf({ VISUAL_CHECK_CACHE_DIR: 'cache' }, 'linux', '/home/ada')).toBe(resolve('cache'))
  })

  it('ignores an empty VISUAL_CHECK_CACHE_DIR', () => {
    expect(cacheFolderOf({ VISUAL_CHECK_CACHE_DIR: '' }, 'linux', '/home/ada')).toBe('/home/ada/.cache/visual-check')
  })
})
