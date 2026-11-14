import { relative, sep } from 'node:path'
import { BaselineError } from '../baselines/baseline-error.js'
import { baselinePathOf, isByteIdentical, readBaseline, writeBaseline } from '../baselines/baseline-files.js'
import { BrowserMismatchError, runImageOf } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import type { CaptureSettings, StoryToCapture } from '../capture/capture-session.js'
import { BrowserExitedError, BrowserLaunchError } from '../capture/driver/driver.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import { ContainerError } from '../container/container-error.js'
import { type Story, storyUrlOf } from '../storybook/read-stories.js'
import { dockerProblemOf } from './docker-problem.js'
import { type BrowserPlace, type LaunchBrowser, type RunBrowser, runBrowserOf } from './launch-browser.js'

/**
 * The stories a run covers in one Storybook, in the order they are captured.
 */
interface StorybookSelection {
  /**
   * The Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * Its selected stories.
   */
  stories: Story[]
}

/**
 * What a `test` or `update` run needs once its checks have passed.
 */
interface SnapshotRun {
  /**
   * The command that runs.
   */
  command: 'test' | 'update'
  /**
   * The CLI's version, for the header.
   */
  version: string
  /**
   * The resolved config.
   */
  config: ResolvedConfig
  /**
   * Where the browser runs.
   */
  place: BrowserPlace
  /**
   * The installed browser package.
   */
  browserPackage: BrowserPackage
  /**
   * The Storybooks in config order, each with its selected stories.
   */
  selections: StorybookSelection[]
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * Whether visual-check runs inside a container, which decides what a Docker problem suggests.
   */
  insideContainer: boolean
  /**
   * Launches the browser, at the first story that needs a capture.
   */
  launchBrowser: LaunchBrowser
  /**
   * Writes the progress of the browser's launch, such as an image pull, as it happens.
   */
  progress: (text: string) => void
}

/**
 * What a run printed and how it exits.
 */
interface SnapshotRunResult {
  /**
   * The exit code.
   */
  exitCode: number
  /**
   * The header, one line per snapshot and the counts, or the lines printed before a failure that stopped the run.
   */
  stdout: string
  /**
   * What stopped the run, or nothing.
   */
  stderr: string
}

/**
 * What became of one snapshot: a `test` status, or an `update` one. `broken` belongs to both.
 */
type SnapshotStatus = 'passed' | 'differs' | 'missing' | 'broken' | 'written' | 'kept'

/**
 * One snapshot's status and the text its line ends with.
 */
interface SnapshotResult {
  /**
   * What became of the snapshot.
   */
  status: SnapshotStatus
  /**
   * The line's last column, such as `142 ms` or `differs: …`.
   */
  detail: string
}

/**
 * The mark each status's line starts with.
 */
const marks: Record<SnapshotStatus, string> = {
  passed: '✓',
  written: '✓',
  kept: '✓',
  differs: '✗',
  missing: '✗',
  broken: '!',
}

/**
 * Per command, the statuses the counts line names, in order, and the statuses that make the run exit 1.
 */
const statusesOf: Record<SnapshotRun['command'], { counted: SnapshotStatus[]; failing: SnapshotStatus[] }> = {
  test: { counted: ['passed', 'differs', 'broken', 'missing'], failing: ['differs', 'broken', 'missing'] },
  update: { counted: ['written', 'kept', 'broken'], failing: ['broken'] },
}

/**
 * What each failed baseline call asks the person to check, after its reason.
 */
const baselineFixes: Record<BaselineError['action'], string> = {
  read: "Check that it's a file visual-check can read.",
  write: 'Check that its folder is writable and the disk has room.',
}

/**
 * Builds the header: the CLI's version, the command, how many snapshots the run captures and how many workers.
 */
function headerOf(run: SnapshotRun): string {
  const count = run.selections.reduce((sum, selection) => sum + selection.stories.length, 0)
  const snapshots = `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`

  return `visual-check ${run.version} · ${run.command} · ${snapshots} · 1 worker`
}

/**
 * Builds the session's settings from the config.
 */
function captureSettingsOf(config: ResolvedConfig): CaptureSettings {
  const { width, height, deviceScaleFactor } = config.viewport

  return {
    viewport: { width, height, deviceScaleFactor },
    readyTimeoutMs: config.readyTimeout,
    timezone: config.timezone,
    locale: config.locale,
    colorScheme: config.colorScheme,
  }
}

/**
 * Gives the story's ID and the URL of its own page.
 */
function storyToCaptureOf(storybook: ResolvedStorybook, story: Story): StoryToCapture {
  return { id: story.id, url: storyUrlOf(storybook.url, story.id) }
}

/**
 * Writes a path relative to the folder the CLI runs in, with `/` on every OS.
 */
function displayPathOf(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/')
}

/**
 * Tests one story: a missing baseline is reported without a capture, and a snapshot passes only when it holds the
 * baseline's bytes.
 */
async function testSnapshot(storybook: ResolvedStorybook, story: Story, browser: RunBrowser): Promise<SnapshotResult> {
  const baseline = await readBaseline(baselinePathOf(storybook.baselines, story.id))

  if (baseline === undefined) {
    return { status: 'missing', detail: 'missing: no baseline yet; run visual-check update to write it' }
  }

  const session = await browser.session()
  const started = performance.now()
  const capture = await session.capture(storyToCaptureOf(storybook, story))

  if ('broken' in capture) {
    return { status: 'broken', detail: `broken: ${capture.broken}` }
  }

  if (!isByteIdentical(capture.snapshot, baseline)) {
    return { status: 'differs', detail: "differs: the snapshot isn't byte-identical to its baseline" }
  }

  return { status: 'passed', detail: `${Math.round(performance.now() - started)} ms` }
}

/**
 * Updates one story's baseline: writes the snapshot when the baseline is missing or differs, and leaves an identical
 * baseline untouched. A broken story writes nothing.
 */
async function updateSnapshot(
  storybook: ResolvedStorybook,
  story: Story,
  browser: RunBrowser,
  cwd: string,
): Promise<SnapshotResult> {
  const capture = await (await browser.session()).capture(storyToCaptureOf(storybook, story))

  if ('broken' in capture) {
    return { status: 'broken', detail: `broken: ${capture.broken}` }
  }

  const path = baselinePathOf(storybook.baselines, story.id)
  const baseline = await readBaseline(path)

  if (baseline !== undefined && isByteIdentical(capture.snapshot, baseline)) {
    return { status: 'kept', detail: 'kept' }
  }

  await writeBaseline(path, capture.snapshot)

  return { status: 'written', detail: `written ${displayPathOf(cwd, path)}` }
}

/**
 * Builds the counts line: each counted status with its count, leaving out zero counts except the first.
 */
function countsLineOf(command: SnapshotRun['command'], statuses: SnapshotStatus[]): string {
  return statusesOf[command].counted
    .flatMap((counted, index) => {
      const count = statuses.filter((status) => status === counted).length

      return index === 0 || count > 0 ? [`${count} ${counted}`] : []
    })
    .join(' · ')
}

/**
 * Gives the exit code: 1 when any snapshot has a failing status for the command, else 0.
 */
function exitCodeOf(command: SnapshotRun['command'], statuses: SnapshotStatus[]): number {
  return statuses.some((status) => statusesOf[command].failing.includes(status)) ? 1 : 0
}

/**
 * Writes the browser's last output lines under a heading, or nothing when there are none.
 */
function browserOutputOf(output: readonly string[]): string {
  return output.length === 0 ? '' : `The browser's last output:\n${output.map((line) => `  ${line}\n`).join('')}`
}

/**
 * Gives the next step after the browser failed to launch or exited while in use, pointing to its output first when it
 * printed any.
 */
function browserFixOf(
  error: BrowserLaunchError | BrowserExitedError,
  place: BrowserPlace,
  headlessShell: string,
): string {
  const why = error.output.length === 0 ? '' : "The browser's output below may say why. "

  if (!(error instanceof BrowserLaunchError)) {
    return `${why}Running out of memory is a common cause. Run visual-check again.`
  }

  return place.in === 'image'
    ? `${why}Check that ${headlessShell} starts in this container, then run visual-check again.`
    : `${why}Check that Docker can run images for ${place.platform}, then run visual-check again.`
}

/**
 * Gives what to print for an error that stops the run with exit 2: a baseline that can't be read or written, Docker's
 * error, a failed launch's or a browser exit's with the next step and the browser's last output, or a version
 * mismatch. Any other error gives `undefined`.
 */
function stopMessageOf(error: unknown, run: SnapshotRun): string | undefined {
  if (error instanceof BaselineError) {
    return (
      `visual-check couldn't ${error.action} the baseline ${displayPathOf(run.cwd, error.path)}: ${error.reason}. ` +
      `${baselineFixes[error.action]}\n`
    )
  }

  if (error instanceof BrowserLaunchError || error instanceof BrowserExitedError) {
    const fix = browserFixOf(error, run.place, run.browserPackage.headlessShell)

    return `${error.message}\n${fix}\n${browserOutputOf(error.output)}`
  }

  if (error instanceof ContainerError) {
    return dockerProblemOf(error, {
      insideContainer: run.insideContainer,
      image: runImageOf(run.browserPackage, run.config.image),
    })
  }

  if (error instanceof BrowserMismatchError) {
    return `${error.message}\n`
  }

  return undefined
}

/**
 * Captures every selected story, in config order and then selection order, and prints one line per snapshot after
 * the header, then the counts. `test` compares each snapshot with its baseline byte for byte and never captures a
 * missing baseline; `update` writes each snapshot whose baseline is missing or differs. The browser is launched at
 * the first story that needs a capture, so a run with nothing to capture launches nothing. A baseline that can't be
 * read or written, a failed launch, a version mismatch or a browser exit stops the run with exit 2, keeping the lines
 * printed so far. The session and the browser are always closed.
 *
 * @throws {Error} Any other error, after closing the session and the browser.
 */
export async function runSnapshots(run: SnapshotRun): Promise<SnapshotRunResult> {
  const lines = [headerOf(run)]
  const printed = (): string => lines.map((line) => `${line}\n`).join('')
  const browser = runBrowserOf(run.launchBrowser, {
    browserPackage: run.browserPackage,
    configImage: run.config.image,
    place: run.place,
    settings: captureSettingsOf(run.config),
    progress: run.progress,
  })
  const statuses: SnapshotStatus[] = []

  try {
    for (const { storybook, stories } of run.selections) {
      for (const story of stories) {
        const result =
          run.command === 'test'
            ? await testSnapshot(storybook, story, browser)
            : await updateSnapshot(storybook, story, browser, run.cwd)

        statuses.push(result.status)
        lines.push(`${marks[result.status]} ${storybook.name}  ${story.id}  ${result.detail}`)
      }
    }
  } catch (error) {
    const message = stopMessageOf(error, run)

    if (message === undefined) {
      throw error
    }

    return { exitCode: 2, stdout: printed(), stderr: message }
  } finally {
    await browser.close()
  }

  lines.push(countsLineOf(run.command, statuses))

  return { exitCode: exitCodeOf(run.command, statuses), stdout: printed(), stderr: '' }
}
