import { BaselineError } from '../baselines/baseline-error.js'
import { BrowserMismatchError, runImageOf } from '../browser/browser-version.js'
import type { ChromeForTestingPlatform } from '../browser/chrome-for-testing-platform.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import { headlessShellPathsOf } from '../browser-download/install-headless-shell.js'
import { BrowserExitedError, BrowserLaunchError } from '../capture/driver/driver.js'
import type { ResolvedConfig } from '../config/resolve-config.js'
import { ContainerError } from '../container/container-error.js'
import { ReportError } from '../report/report-folder.js'
import { VisualDiffError } from '../visual-diff/visual-diff.js'
import type { BrowserPlace } from './browser-route.js'
import { dockerProblemOf } from './docker-problem.js'
import { missingLibraryOf } from './missing-library.js'
import { platformProblemOf } from './platform-problem.js'
import type { FirstBrowserExit } from './run-browser.js'
import { displayPathOf } from './run-output.js'
import { SnapshotDecodeError } from './snapshot-result.js'

/**
 * What the exit-2 messages need to know about a run, apart from the error that stopped it.
 *
 * @public
 */
export interface StopContext {
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * Where the browser runs.
   */
  place: BrowserPlace
  /**
   * The parts of the resolved config the messages read.
   */
  config: Pick<ResolvedConfig, 'platform' | 'image'>
  /**
   * The installed browser package.
   */
  browserPackage: BrowserPackage
  /**
   * The environment, for where the headless shell is downloaded to on the host.
   */
  environment: Record<string, string | undefined>
  /**
   * Whether visual-check runs inside a container, which decides what a Docker problem suggests.
   */
  insideContainer: boolean
}

/**
 * What each failed baseline call asks the person to check, after its reason.
 */
const baselineFixes: Record<BaselineError['action'], string> = {
  read: "Check that it's a file visual-check can read.",
  decode: 'Delete it or restore it from git, then run visual-check again.',
  write: 'Check that its folder is writable and the disk has room.',
  delete: 'Check that its folder is writable.',
  list: "Check that it's a folder visual-check can read.",
}

/**
 * What each failed report call asks the person to check, after its reason.
 */
const reportFixes: Record<ReportError['action'], string> = {
  clear: 'Check that visual-check can remove it.',
  write: 'Check that its folder is writable and the disk has room.',
  copy: "Check that it's a file visual-check can read.",
}

/**
 * Writes the browser's last output lines under a heading, or nothing when there are none.
 */
function browserOutputOf(output: readonly string[]): string {
  return output.length === 0 ? '' : `The browser's last output:\n${output.map((line) => `  ${line}\n`).join('')}`
}

/**
 * Says that the first browser exited mid-run: the exit, whether visual-check relaunches the browser for the rest of
 * the run, and the browser's last output. Gives nothing when the browser didn't exit.
 *
 * @public
 */
export function exitNoticeOf(exit: FirstBrowserExit | undefined): string {
  if (exit === undefined) {
    return ''
  }

  const relaunch = exit.relaunched
    ? 'visual-check relaunches it once for the rest of the run.'
    : "No story left needed a capture, so visual-check didn't relaunch the browser."

  return `${exit.error.message}\n${relaunch}\n${browserOutputOf(exit.error.output)}`
}

/**
 * Gives the next step after the browser failed to launch or exited while in use, pointing to its output first when it
 * printed any.
 */
function browserFixOf(error: BrowserLaunchError | BrowserExitedError, context: StopContext): string {
  const why = error.output.length === 0 ? '' : "The browser's output below may say why. "

  if (!(error instanceof BrowserLaunchError)) {
    return `${why}Running out of memory is a common cause. Run visual-check again.`
  }

  return `${why}Check that ${whatToCheckOf(context)}, then run visual-check again.`
}

/**
 * Gives what to check after the browser failed to launch where it runs: that the image's headless shell starts in this
 * container, that Docker can run the platform's images, or that the downloaded executable starts on this machine.
 */
function whatToCheckOf(context: StopContext): string {
  switch (context.place.in) {
    case 'image':
      return `${context.browserPackage.headlessShell} starts in this container`
    case 'container':
      return `Docker can run images for ${context.place.platform}`
    case 'host':
      return `${hostExecutableOf(context, context.place.platform)} starts on this machine`
  }
}

/**
 * Gives the path of the headless shell's executable that visual-check downloads for the platform on the host.
 */
function hostExecutableOf(context: StopContext, platform: ChromeForTestingPlatform): string {
  return headlessShellPathsOf(context.environment, context.browserPackage.chromium, platform).executable
}

/**
 * Gives what to print when the browser on the host can't start because Linux lacks a shared library it links against:
 * the library, both ways out, how to list every missing library, since the loader names only the first, and the
 * browser's last output.
 */
function missingLibraryMessageOf(
  library: string,
  context: StopContext,
  platform: ChromeForTestingPlatform,
  output: readonly string[],
): string {
  const containerPlatform = platform === 'linux-arm64' ? 'linux/arm64' : 'linux/amd64'

  return (
    `The browser can't start because ${library} is missing.\n` +
    "Install the libraries the headless shell needs, since visual-check doesn't install system packages, or set " +
    `platform to '${containerPlatform}' in the config to run the browser in visual-check's container.\n` +
    `To list every missing library, run: ldd '${hostExecutableOf(context, platform)}' | grep 'not found'\n` +
    browserOutputOf(output)
  )
}

/**
 * Gives what to print for a browser that failed to launch or exited while in use: the platform problem when it stopped
 * before any capture with output saying its graphics process can't start, for its container's platform, or the
 * config's inside visual-check's image unless that is `host`; for a failed launch on the host whose output names a
 * missing library, that library, both ways out and how to list every missing one. Otherwise the error's message, the
 * next step and the browser's last output.
 */
function browserStopMessageOf(
  error: BrowserLaunchError | BrowserExitedError,
  context: StopContext,
  capturedAny: boolean,
): string {
  const platform = context.place.in === 'container' ? context.place.platform : context.config.platform

  if (platform !== 'host' && !capturedAny && error.graphicsFailed) {
    return `${platformProblemOf(platform)}${browserOutputOf(error.output)}`
  }

  if (error instanceof BrowserLaunchError && context.place.in === 'host') {
    const library = missingLibraryOf(error.output)

    if (library !== undefined) {
      return missingLibraryMessageOf(library, context, context.place.platform, error.output)
    }
  }

  return `${error.message}\n${browserFixOf(error, context)}\n${browserOutputOf(error.output)}`
}

/**
 * Gives what to print when the visual diff can't run: sharp's reason and to reinstall its build for this machine, or
 * the reason a thread stopped and the next step.
 */
function visualDiffStopMessageOf(error: VisualDiffError): string {
  if (error.kind === 'sharp-unavailable') {
    return (
      `visual-check couldn't load sharp, which it compares images with: ${error.reason}. ` +
      `Reinstall your dependencies on this machine so sharp's build for ${process.platform}-${process.arch} is ` +
      'installed, then run visual-check again.\n'
    )
  }

  return (
    `A visual diff thread stopped: ${error.reason}.\n` +
    'Running out of memory is a common cause. Free some memory, or set fewer workers so fewer images are compared at ' +
    'once, then run visual-check again.\n'
  )
}

/**
 * Gives what to print for an error that stops the run with exit 2: a baseline that can't be read, decoded, written or
 * deleted, a baselines folder that can't be listed, a report folder that can't be cleared or written to, a snapshot
 * the browser returned that can't be decoded, sharp that can't be loaded, a visual diff thread that stopped, Docker's
 * error, a failed download, a failed launch's or a browser exit's with the next step and the browser's last output, or
 * a version mismatch. A browser that fails or exits before any capture, with output saying its graphics process can't
 * start, gives the platform problem for its container's platform, or the config's inside visual-check's image unless
 * that is `host`, instead of the next step. A failed launch on the host whose output names a missing library gives that
 * library and both ways out. Any other error gives `undefined`.
 *
 * `capturedAny` is whether a snapshot has been captured, which a broken or missing one hasn't.
 *
 * @public
 */
export function stopMessageOf(error: unknown, context: StopContext, capturedAny: boolean): string | undefined {
  if (error instanceof BaselineError) {
    return (
      `visual-check couldn't ${error.action} ${error.subject} ${displayPathOf(context.cwd, error.path)}: ${error.reason}. ` +
      `${baselineFixes[error.action]}\n`
    )
  }

  if (error instanceof ReportError) {
    return (
      `visual-check couldn't ${error.action} ${displayPathOf(context.cwd, error.path)}: ${error.reason}. ` +
      `${reportFixes[error.action]}\n`
    )
  }

  if (error instanceof SnapshotDecodeError) {
    return (
      `visual-check couldn't decode the snapshot the browser returned for ${error.storybook}  ${error.key}: ` +
      `${error.reason}. Run visual-check again, and report it if it keeps happening.\n`
    )
  }

  if (error instanceof VisualDiffError) {
    return visualDiffStopMessageOf(error)
  }

  if (error instanceof BrowserLaunchError || error instanceof BrowserExitedError) {
    return browserStopMessageOf(error, context, capturedAny)
  }

  if (error instanceof ContainerError) {
    return dockerProblemOf(error, {
      insideContainer: context.insideContainer,
      image: runImageOf(context.browserPackage, context.config.image),
    })
  }

  if (error instanceof BrowserDownloadError || error instanceof BrowserMismatchError) {
    return `${error.message}\n`
  }

  return undefined
}
