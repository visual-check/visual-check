import * as path from 'node:path'

/**
 * The OS's user cache folder: on macOS `<home>/Library/Caches`; on Windows `LOCALAPPDATA`, else
 * `<home>/AppData/Local`; on Linux and other Unixes `XDG_CACHE_HOME` when it is an absolute path, else `<home>/.cache`.
 */
function userCacheFolderOf(
  environment: Record<string, string | undefined>,
  os: NodeJS.Platform,
  homeDir: string,
): string {
  if (os === 'darwin') {
    return path.posix.join(homeDir, 'Library', 'Caches')
  }

  if (os === 'win32') {
    const localAppData = environment.LOCALAPPDATA

    return localAppData !== undefined && localAppData !== ''
      ? localAppData
      : path.win32.join(homeDir, 'AppData', 'Local')
  }

  const xdgCacheHome = environment.XDG_CACHE_HOME

  return xdgCacheHome !== undefined && path.posix.isAbsolute(xdgCacheHome)
    ? xdgCacheHome
    : path.posix.join(homeDir, '.cache')
}

/**
 * The folder visual-check caches downloads in: `VISUAL_CHECK_CACHE_DIR` as an absolute path when it is set and not
 * empty, else `visual-check` in the OS's user cache folder. Paths follow the given OS's rules, so Windows paths come
 * out the same on any machine.
 */
export function cacheFolderOf(
  environment: Record<string, string | undefined>,
  os: NodeJS.Platform,
  homeDir: string,
): string {
  const paths = os === 'win32' ? path.win32 : path.posix
  const cacheDir = environment.VISUAL_CHECK_CACHE_DIR

  if (cacheDir !== undefined && cacheDir !== '') {
    return paths.resolve(cacheDir)
  }

  return paths.join(userCacheFolderOf(environment, os, homeDir), 'visual-check')
}
