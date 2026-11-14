import { randomBytes } from 'node:crypto'
import { access, mkdir, readdir, readFile, readlink, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { BrowserDownloadError, reasonOf } from './browser-download-error.js'
import { cacheFolderOf } from './cache-folder.js'
import { downloadFile, printable } from './download-file.js'
import { proxyFor } from './proxy.js'
import { unzip } from './unzip.js'

/**
 * Where Chrome for Testing serves its downloads, unless `VISUAL_CHECK_CHROMIUM_MIRROR` names a mirror.
 */
const chromeForTestingBase = 'https://storage.googleapis.com/chrome-for-testing-public'

/**
 * Where a user reports a problem visual-check can't explain.
 */
const issuesUrl = 'https://github.com/visual-check/visual-check/issues'

/**
 * The fix for a cache folder visual-check can't write to.
 */
const moveCacheFix = 'Set VISUAL_CHECK_CACHE_DIR to move it to a folder visual-check can write to.'

/**
 * How often, in milliseconds, a run waiting for another run's download checks on it.
 */
const lockPollMs = 250

/**
 * How old, in milliseconds, a lock's last heartbeat, or a run's temporary file, must be before it counts as left by a
 * run that died.
 */
const staleMs = 30_000

/**
 * How often, in milliseconds, the run holding the lock shows it is alive.
 */
const heartbeatMs = 5_000

/**
 * How many times a rename is tried on Windows, where antivirus software briefly holds new files.
 */
const renameAttempts = 50

/**
 * How long, in milliseconds, a rename waits between tries on Windows.
 */
const renameRetryMs = 100

/**
 * The error codes Windows gives a rename while another program holds a file.
 */
const busyCodes = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * The file in the lock folder that names the run holding it.
 */
const ownerFileName = 'owner.json'

/**
 * Which headless shell `installHeadlessShell` installs, where it looks for the cache, and where its progress goes.
 *
 * @public
 */
export interface InstallHeadlessShellOptions {
  /**
   * The Chromium version, such as `157.0.8103.78`.
   */
  version: string
  /**
   * The Chrome for Testing platform, such as `mac-arm64`.
   */
  platform: string
  /**
   * The SHA-256 the download must have, as lowercase hex, from the browser package.
   */
  sha256: string
  /**
   * The browser package's version, which a checksum mismatch names.
   */
  packageVersion: string
  /**
   * The environment, for `VISUAL_CHECK_CACHE_DIR`, `VISUAL_CHECK_CHROMIUM_MIRROR`, the proxy and the OS's cache
   * folder.
   */
  environment: Record<string, string | undefined>
  /**
   * The OS whose cache folder to use. The machine's unless given.
   */
  os?: NodeJS.Platform
  /**
   * The user's home folder. The machine's unless given.
   */
  homeDir?: string
  /**
   * Takes each line of progress, newline included.
   */
  progress: (text: string) => void
}

/**
 * Where one headless shell lives in its version folder.
 */
interface ShellPaths {
  /**
   * `<cache folder>/chromium/<version>/`.
   */
  versionFolder: string
  /**
   * The folder the zip holds, `chrome-headless-shell-<platform>`, as its path in the zip.
   */
  shellFolderName: string
  /**
   * The executable, as its path in the zip.
   */
  executableName: string
  /**
   * The installed `chrome-headless-shell-<platform>/` folder.
   */
  shellFolder: string
  /**
   * The installed executable.
   */
  executable: string
  /**
   * The completion marker, an empty file written last.
   */
  marker: string
  /**
   * The lock folder, made by the run that downloads.
   */
  lock: string
}

/**
 * The temporary files of one run, in the version folder, named by the run's token.
 */
interface RunFiles {
  /**
   * The zip being downloaded, `.download-<token>.zip`.
   */
  zip: string
  /**
   * The folder the zip is extracted into, `.extract-<token>/`.
   */
  extractFolder: string
}

/**
 * What one run downloads, how, and the token naming its temporary files.
 */
interface RunDownload {
  /**
   * The zip's URL.
   */
  url: URL
  /**
   * The proxy the download goes through, or `undefined` to connect directly.
   */
  proxy: URL | undefined
  /**
   * The token naming the run's temporary files.
   */
  token: string
}

/**
 * The run holding a lock, as the owner file in the lock folder names it.
 */
interface LockOwner {
  /**
   * The process ID of the run.
   */
  pid: number
  /**
   * The name of the machine the run is on.
   */
  hostname: string
  /**
   * The token naming the run's temporary files.
   */
  token: string
  /**
   * The Linux PID namespace the run is in, such as `pid:[4026531836]`, so containers that share a hostname and a
   * cache don't read each other's process IDs. None elsewhere.
   */
  pidNamespace?: string
}

/**
 * Where the headless shell of a Chromium version for a Chrome for Testing platform is cached, whether or not it is
 * there yet: in `chromium/<version>/` in the cache folder, which is `VISUAL_CHECK_CACHE_DIR`, else `visual-check` in
 * the OS's user cache folder. The OS and the home folder are this machine's unless given.
 */
function shellPathsFor(
  environment: Record<string, string | undefined>,
  version: string,
  platform: string,
  os: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
): ShellPaths {
  const versionFolder = join(cacheFolderOf(environment, os, homeDir), 'chromium', version)
  const shellFolderName = `chrome-headless-shell-${platform}`
  const executableName = `${shellFolderName}/chrome-headless-shell${platform === 'win64' ? '.exe' : ''}`

  return {
    versionFolder,
    shellFolderName,
    executableName,
    shellFolder: join(versionFolder, shellFolderName),
    executable: join(versionFolder, executableName),
    marker: join(versionFolder, `${shellFolderName}.done`),
    lock: join(versionFolder, `${shellFolderName}.lock`),
  }
}

/**
 * The temporary files of the run with the token.
 */
function runFilesOf(versionFolder: string, token: string): RunFiles {
  return {
    zip: join(versionFolder, `.download-${token}.zip`),
    extractFolder: join(versionFolder, `.extract-${token}`),
  }
}

/**
 * Removes the file or folder, with what it holds. Gone already counts as removed. On Windows, where antivirus software
 * briefly holds new files, a failure is tried again up to 10 times.
 */
async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 10 : 0 })
}

/**
 * Whether the path exists.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

/**
 * How long ago, in milliseconds, the path last changed, or `undefined` when it is gone. A time in the future, which
 * another machine's clock can give a shared cache, counts by how far ahead it is.
 */
async function ageOf(path: string): Promise<number | undefined> {
  try {
    return Math.abs(Date.now() - (await stat(path)).mtimeMs)
  } catch {
    return undefined
  }
}

/**
 * Whether the headless shell is installed: its marker and its executable both exist.
 */
async function isReady(paths: ShellPaths): Promise<boolean> {
  const [marker, executable] = await Promise.all([exists(paths.marker), exists(paths.executable)])

  return marker && executable
}

/**
 * The URL of the platform's headless shell zip: on `VISUAL_CHECK_CHROMIUM_MIRROR` when it is set and not empty, else
 * on Chrome for Testing.
 *
 * @throws {BrowserDownloadError} When the mirror isn't an http:// or https:// URL. The value isn't printed, since it
 * can hold credentials.
 */
export function downloadUrlOf(environment: Record<string, string | undefined>, version: string, platform: string): URL {
  const mirror = environment.VISUAL_CHECK_CHROMIUM_MIRROR
  const base = mirror !== undefined && mirror !== '' ? mirror.replace(/\/+$/, '') : chromeForTestingBase
  const text = `${base}/${version}/${platform}/chrome-headless-shell-${platform}.zip`
  const url = URL.canParse(text) ? new URL(text) : undefined

  if (url === undefined || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new BrowserDownloadError(
      'VISUAL_CHECK_CHROMIUM_MIRROR must be an http:// or https:// URL, ' +
        'such as https://mirror.example.com/chrome-for-testing-public.',
    )
  }

  return url
}

/**
 * The fix for a download with the wrong SHA-256: to check the mirror when there is one; else to check the proxy,
 * which can answer with a page of its own, when there is one; else to run again and report it if it happens again.
 */
function checksumFixOf(environment: Record<string, string | undefined>, url: URL): string {
  if ((environment.VISUAL_CHECK_CHROMIUM_MIRROR ?? '') !== '') {
    return "Check that VISUAL_CHECK_CHROMIUM_MIRROR serves Chrome for Testing's files unchanged."
  }

  const proxy = proxyFor(url, environment)

  if (proxy !== undefined) {
    return (
      `The proxy ${proxy.origin} may have changed it: check that it lets ${url.host} through unchanged, ` +
      'then run visual-check again.'
    )
  }

  return `Run visual-check again, and if it happens again, report it at ${issuesUrl}.`
}

/**
 * The message for a download from the URL whose SHA-256 isn't the one the browser package expects, with its fix.
 */
export function checksumMismatchOf(options: InstallHeadlessShellOptions, url: URL, actual: string): string {
  const { version, platform, sha256, packageVersion, environment } = options

  return (
    `The download of Chromium ${version} (${platform}) from ${printable(url)} has SHA-256 ${actual}, ` +
    `but the browser package @visual-check/chromium ${packageVersion} expects ${sha256}. ` +
    checksumFixOf(environment, url)
  )
}

/**
 * The message for a download with the right SHA-256 that couldn't be unzipped into the version folder, from unzip's
 * error. The zip is a temporary file, so the message names the version folder. An error the file system gave, such as
 * a full disk, which carries the call that failed, says to move the cache. Any other, such as a zip that is damaged
 * though its SHA-256 matches, is one to report.
 */
export function unzipFailureOf(label: string, versionFolder: string, error: unknown): string {
  const fromFileSystem = typeof (error as NodeJS.ErrnoException | undefined)?.syscall === 'string'
  const fix = fromFileSystem ? moveCacheFix : `Report it at ${issuesUrl}.`

  return `Couldn't unzip ${label} into ${versionFolder}: ${reasonOf(error)}. ${fix}`
}

/**
 * Makes the version folder and the folders above it.
 *
 * @throws {BrowserDownloadError} Naming the folder, when it can't be made.
 */
async function makeVersionFolder(versionFolder: string): Promise<void> {
  try {
    await mkdir(versionFolder, { recursive: true })
  } catch (error) {
    throw new BrowserDownloadError(
      `Couldn't make the folder ${versionFolder} to download Chromium into: ${reasonOf(error)}. ${moveCacheFix}`,
    )
  }
}

/**
 * Removes the temporary files of the run with the token, ignoring failures.
 */
async function removeRunFiles(versionFolder: string, token: string): Promise<void> {
  const files = runFilesOf(versionFolder, token)

  await Promise.all([files.zip, files.extractFolder].map((path) => removePath(path).catch(() => undefined)))
}

/**
 * Removes the temporary files that runs left more than 30 s ago, ignoring failures. A live run's are newer: its zip
 * grows as it downloads, and its extraction follows at once.
 */
async function removeOldRunFiles(versionFolder: string): Promise<void> {
  const names = await readdir(versionFolder).catch((): string[] => [])

  await Promise.all(
    names
      .filter((name) => name.startsWith('.download-') || name.startsWith('.extract-'))
      .map(async (name) => {
        const path = join(versionFolder, name)
        const age = await ageOf(path)

        if (age !== undefined && age > staleMs) {
          await removePath(path).catch(() => undefined)
        }
      }),
  )
}

/**
 * Makes the lock folder, which only one run can do, and names this run in it. Gives whether this run made it. A
 * failure to write the owner file is ignored: the lock then counts as live until it is stale.
 */
async function makeLock(lock: string, token: string): Promise<boolean> {
  try {
    await mkdir(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }

    throw error
  }

  const pidNamespace = await pidNamespaceOfThisRun()
  const owner: LockOwner = {
    pid: process.pid,
    hostname: hostname(),
    token,
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
  }

  await writeFile(join(lock, ownerFileName), JSON.stringify(owner)).catch(() => undefined)

  return true
}

/**
 * The Linux PID namespace this run is in, or `undefined` where there's none to read.
 */
async function pidNamespaceOfThisRun(): Promise<string | undefined> {
  return readlink('/proc/self/ns/pid').catch(() => undefined)
}

/**
 * Whether the value is a lock owner as `makeLock` writes it. The token must be hex, since it names files.
 */
function isLockOwner(value: unknown): value is LockOwner {
  const owner = value as Partial<LockOwner> | null

  return (
    typeof owner?.pid === 'number' &&
    owner.pid > 0 &&
    typeof owner.hostname === 'string' &&
    typeof owner.token === 'string' &&
    /^[0-9a-f]+$/.test(owner.token) &&
    (owner.pidNamespace === undefined || typeof owner.pidNamespace === 'string')
  )
}

/**
 * The run the lock's owner file names, or `undefined` when the lock has no owner file yet, or one that is half written
 * or not visual-check's.
 */
async function ownerOf(lock: string): Promise<LockOwner | undefined> {
  try {
    const owner: unknown = JSON.parse(await readFile(join(lock, ownerFileName), 'utf8'))

    return isLockOwner(owner) ? owner : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the run that owns a lock was on this machine, in this run's PID namespace, and has exited, as when it was
 * stopped with Ctrl+C. Only there do process IDs mean the same to both runs.
 */
async function hasExited(owner: LockOwner): Promise<boolean> {
  if (owner.hostname !== hostname() || owner.pidNamespace !== (await pidNamespaceOfThisRun())) {
    return false
  }

  try {
    process.kill(owner.pid, 0)

    return false
  } catch (error) {
    // EPERM says the process runs, as another user.
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/**
 * Holds the lock this run made: refreshes its time every 5 s, so other runs see it is alive. Gives what releases it.
 */
function holdLock(lock: string): () => Promise<void> {
  const heartbeat = setInterval(() => {
    const now = new Date()

    utimes(lock, now, now).catch(() => undefined)
  }, heartbeatMs)

  heartbeat.unref()

  return async () => {
    clearInterval(heartbeat)
    // A lock left behind is taken over once it is stale, so a failure here doesn't hide the run's own result.
    await removePath(lock).catch(() => undefined)
  }
}

/**
 * Whether the lock is stale: its run hasn't shown it is alive for 30 s. A lock that is gone counts as stale.
 */
async function isStale(lock: string): Promise<boolean> {
  const age = await ageOf(lock)

  return age === undefined || age > staleMs
}

/**
 * Removes the lock when it was left behind: its run exited on this machine, whose temporary files go too, or it is
 * stale. Gives whether it removed it. Another run can take over the same lock first, making a new lock between this
 * removal's emptying of the folder and its removal of the folder. The folder then isn't empty, so it stays, and this
 * gives `false`.
 */
async function removeIfLeftBehind(paths: ShellPaths): Promise<boolean> {
  const owner = await ownerOf(paths.lock)

  if (owner !== undefined && (await hasExited(owner))) {
    await removeRunFiles(paths.versionFolder, owner.token)
  } else if (!(await isStale(paths.lock))) {
    return false
  }

  try {
    await removePath(paths.lock)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
      return false
    }

    throw error
  }
}

/**
 * Takes the lock, naming this run in it. While another run holds it, says so once and waits, checking every 250 ms
 * whether that run installed the headless shell. Takes over a lock left behind. Gives what releases the lock, or
 * `undefined` when another run installed the headless shell meanwhile.
 */
async function takeLock(
  paths: ShellPaths,
  token: string,
  options: InstallHeadlessShellOptions,
): Promise<(() => Promise<void>) | undefined> {
  let waiting = false

  for (;;) {
    if (await makeLock(paths.lock, token)) {
      return holdLock(paths.lock)
    }

    if (await isReady(paths)) {
      return undefined
    }

    // When another run took the lock over first, this one waits for it like for any other.
    if (await removeIfLeftBehind(paths)) {
      continue
    }

    if (!waiting) {
      options.progress(`Waiting for another visual-check run to download Chromium ${options.version}…\n`)
      waiting = true
    }

    await sleep(lockPollMs)
  }
}

/**
 * Moves the shell folder from the checked extraction in the extract folder into place. Other runs can hold the lock
 * too, after taking over one they thought was left behind, so this is safe to do at once in several runs: a rename
 * never replaces a folder with files in it, and nothing removes a complete one. A shell folder only arrives by
 * renaming a checked extraction, so one that holds the executable is complete and is kept. One without it was damaged,
 * as by hand, and is moved aside into the extract folder, which goes at the end. On Windows a rename that antivirus
 * software blocks is tried again for up to 5 s.
 */
async function moveIntoPlace(extractFolder: string, paths: ShellPaths): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(join(extractFolder, paths.shellFolderName), paths.shellFolder)

      return
    } catch (error) {
      // Another run holding the lock too may have moved its own in first.
      if (await exists(paths.executable)) {
        return
      }

      if (attempt === renameAttempts || !(await makeWay(extractFolder, paths, error, attempt))) {
        throw error
      }
    }
  }
}

/**
 * Makes way for another try at moving the shell folder into place after the rename failed with the error: moves a
 * damaged shell folder, one without the executable, aside into the extract folder, and on Windows waits a moment for
 * antivirus software to let go. Gives whether another try can work.
 */
async function makeWay(extractFolder: string, paths: ShellPaths, error: unknown, attempt: number): Promise<boolean> {
  const windows = process.platform === 'win32'

  if (await exists(paths.shellFolder)) {
    await rename(paths.shellFolder, join(extractFolder, `damaged-${attempt}`)).catch(() => undefined)
  } else if (!windows || !busyCodes.has((error as NodeJS.ErrnoException).code ?? '')) {
    return false
  }

  if (windows) {
    await sleep(renameRetryMs)
  }

  return true
}

/**
 * Downloads the zip into a temporary file, checks its SHA-256, extracts it into a temporary folder, moves the shell
 * folder into place, then writes the marker. Removes the temporary files whatever happens.
 */
async function downloadAndInstall(
  options: InstallHeadlessShellOptions,
  paths: ShellPaths,
  run: RunDownload,
): Promise<void> {
  const { version, platform, progress } = options
  const { url, proxy, token } = run
  const label = `Chromium ${version} (${platform})`
  const files = runFilesOf(paths.versionFolder, token)

  try {
    const sha256 = await downloadFile({ url, destination: files.zip, label, proxy, progress })

    if (sha256 !== options.sha256) {
      throw new BrowserDownloadError(checksumMismatchOf(options, url, sha256))
    }

    try {
      await unzip(files.zip, files.extractFolder)
    } catch (error) {
      throw new BrowserDownloadError(unzipFailureOf(label, paths.versionFolder, error))
    }

    if (!(await exists(join(files.extractFolder, paths.executableName)))) {
      throw new BrowserDownloadError(
        `The download of ${label} from ${printable(url)} has no ${paths.executableName}. Report it at ${issuesUrl}.`,
      )
    }

    await moveIntoPlace(files.extractFolder, paths)
    await writeFile(paths.marker, '')
    progress(`Chromium ${version} is in ${paths.versionFolder}\n`)
  } finally {
    await removeRunFiles(paths.versionFolder, token)
  }
}

/**
 * Takes the lock, removes the temporary files runs left long ago, then downloads and installs the headless shell
 * unless another run did meanwhile. Releases the lock whatever happens.
 */
async function installUnderLock(
  options: InstallHeadlessShellOptions,
  paths: ShellPaths,
  url: URL,
  proxy: URL | undefined,
): Promise<void> {
  const token = randomBytes(8).toString('hex')
  const release = await takeLock(paths, token, options)

  if (release === undefined) {
    return
  }

  try {
    await removeOldRunFiles(paths.versionFolder)

    // Another run may have finished between this run's first look and taking the lock.
    if (!(await isReady(paths))) {
      await downloadAndInstall(options, paths, { url, proxy, token })
    }
  } finally {
    await release()
  }
}

/**
 * Where the headless shell of a Chromium version for a platform is cached.
 *
 * @public
 */
export interface HeadlessShellPaths {
  /**
   * The version folder, `chromium/<version>/` in the cache folder, which holds every platform's headless shell of that
   * version.
   */
  folder: string
  /**
   * The headless shell's executable.
   */
  executable: string
}

/**
 * Gives where the headless shell of a Chromium version for a Chrome for Testing platform is cached on this machine,
 * whether or not it is there yet.
 *
 * @public
 */
export function headlessShellPathsOf(
  environment: Record<string, string | undefined>,
  version: string,
  platform: string,
): HeadlessShellPaths {
  const { versionFolder, executable } = shellPathsFor(environment, version, platform)

  return { folder: versionFolder, executable }
}

/**
 * Gives the absolute path of the headless shell's executable, downloading it first when the cache doesn't hold it.
 * The cache folder is `VISUAL_CHECK_CACHE_DIR`, else `visual-check` in the OS's user cache folder, and the headless
 * shell goes in its `chromium/<version>/`. A lock lets one run download while others wait. The download, from
 * `VISUAL_CHECK_CHROMIUM_MIRROR` or Chrome for Testing, through the proxy when one is set, must have the SHA-256 the
 * browser package expects. A marker, written last, says the install is complete. Other versions are never touched.
 * Prints nothing when the cache holds it.
 *
 * @throws {BrowserDownloadError} The whole text for the user, when the mirror or the proxy setting is wrong, the
 * download fails, has the wrong SHA-256 or can't be unzipped, or the cache can't be written.
 * @public
 */
export async function installHeadlessShell(options: InstallHeadlessShellOptions): Promise<string> {
  const { version, platform, environment } = options
  const paths = shellPathsFor(environment, version, platform, options.os, options.homeDir)
  const { versionFolder } = paths

  if (await isReady(paths)) {
    return paths.executable
  }

  const url = downloadUrlOf(environment, version, platform)
  const proxy = proxyFor(url, environment)

  await makeVersionFolder(versionFolder)

  try {
    await installUnderLock(options, paths, url, proxy)
  } catch (error) {
    if (error instanceof BrowserDownloadError) {
      throw error
    }

    throw new BrowserDownloadError(
      `Couldn't install Chromium ${version} in ${versionFolder}: ${reasonOf(error)}. ${moveCacheFix}`,
    )
  }

  return paths.executable
}
