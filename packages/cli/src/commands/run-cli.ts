import { readFileSync } from 'node:fs'
import { checkBrowserPackage } from '../browser/browser-package.js'
import { runImageOf } from '../browser/browser-version.js'
import { imageMarkerPath } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { ConfigError } from '../config/config-error.js'
import { isCi } from '../config/is-ci.js'
import { type LoadConfigOptions, loadConfig } from '../config/load-config.js'
import type { ResolvedConfig } from '../config/resolve-config.js'
import { ContainerError } from '../container/container-error.js'
import { type ProbeDocker, probeDocker } from '../container/docker-probe.js'
import { isInsideContainer } from '../container/inside-container.js'
import { checkStorybooks } from './check-storybooks.js'
import { dockerProblemOf } from './docker-problem.js'
import { type BrowserPlace, type LaunchBrowser, launchBrowser } from './launch-browser.js'
import { parseCommandLine, type RunOptions, UsageError } from './parse-command-line.js'
import { placeBrowser } from './place-browser.js'
import { runSnapshots } from './run-snapshots.js'
import { selectStories } from './select-stories.js'

/**
 * The help text `--help` prints.
 */
const helpText = `Usage: visual-check <command> [options]

Commands:
  init     Set up visual-check in this project
  test     Capture snapshots and compare them with baselines
  update   Write missing and failing baselines and delete orphans (local only)

Options for test and update:
  --all               Cover every story
  --filter <regex>    Cover every story whose ID matches
  --storybook <name>  Cover only this Storybook
  --url <url>         Use this URL for the Storybook (with several Storybooks, needs --storybook)
  --config <path>     Use this config instead of searching for one

Other options:
  --help     Show this help
  --version  Show the version
`

/**
 * What a CLI run produced: the exit code and the text for each output stream.
 *
 * @public
 */
export interface CliResult {
  /**
   * The process exit code.
   */
  exitCode: number
  /**
   * Text for standard output.
   */
  stdout: string
  /**
   * Text for standard error.
   */
  stderr: string
}

/**
 * What the CLI's caller gives a run besides its arguments, environment and folder.
 *
 * @public
 */
export interface RunCliOptions {
  /**
   * Where the marker of visual-check's image is read from. `/etc/visual-check/chromium.json` by default. A test gives
   * another.
   */
  imageMarkerPath?: string
  /**
   * Writes progress as it happens, such as an image pull's. Progress is dropped when it isn't given.
   */
  progress?: (text: string) => void
  /**
   * Launches the browser that `test` and `update` capture in. By default, in visual-check's container the image is
   * pulled when Docker lacks it and the browser starts in the container, and inside visual-check's image the browser
   * starts directly as a child process. Either way it connects over CDP. A test gives a fake.
   */
  launchBrowser?: LaunchBrowser
  /**
   * Asks Docker what its engine has, before a run whose browser runs in visual-check's container reaches a Storybook.
   * Inside visual-check's image no Docker is used, so it isn't asked. By default it runs `docker info`. A test gives a
   * fake.
   */
  probeDocker?: ProbeDocker
  /**
   * Whether visual-check runs inside a container. By default it looks for the file Docker and Podman leave in a
   * container's root, and for `KUBERNETES_SERVICE_HOST`, which Kubernetes sets in every pod. A test gives its answer.
   */
  insideContainer?: boolean
}

/**
 * Runs the CLI with the given arguments, environment and folder, and returns what it prints on each stream. Only
 * progress is written as it happens, through `options.progress`; `update` also writes baselines. Problems with the
 * command line, the config, the run's setup or the browser exit with code 2. Other errors are thrown.
 *
 * @public
 */
export async function runCli(
  commandLineArguments: string[],
  environment: Record<string, string | undefined>,
  cwd: string,
  options: RunCliOptions = {},
): Promise<CliResult> {
  try {
    const commandLine = parseCommandLine(commandLineArguments)

    switch (commandLine.command) {
      case 'help':
        return { exitCode: 0, stdout: helpText, stderr: '' }
      case 'version':
        return { exitCode: 0, stdout: `${readVersion()}\n`, stderr: '' }
      case 'init':
        return failure("visual-check init isn't available yet. Write visual-check.config.ts by hand for now.")
      case 'test':
      case 'update':
        return await runTestOrUpdate(commandLine.command, commandLine.options, environment, cwd, options)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      return failure(`${error.message}\nRun visual-check --help to see the commands and options.`)
    }

    if (error instanceof ConfigError) {
      return failure(error.message)
    }

    throw error
  }
}

/**
 * Runs `test` or `update` after the checks that come first: `update` runs only locally, the browser package is
 * installed and readable, the config is found, valid and usable, the browser has a place to run (inside visual-check's
 * image when its marker fits the browser package and the platform, else in a container, never on the host), Docker
 * answers `docker info` with a running engine of Linux containers when the browser runs in a container, every
 * Storybook in the run has a supported `storybook` version installed, and every Storybook in the run answers with an
 * index. Then it captures the selected stories.
 *
 * @throws {ConfigError} When the config can't be found, loaded or used.
 */
async function runTestOrUpdate(
  command: 'test' | 'update',
  options: RunOptions,
  environment: Record<string, string | undefined>,
  cwd: string,
  cliOptions: RunCliOptions,
): Promise<CliResult> {
  const ci = isCi(environment)

  if (command === 'update' && ci) {
    return failure(
      'visual-check update only runs locally, and the CI environment variable is set. ' +
        'Run it on your machine and commit the baselines, or unset CI.',
    )
  }

  const browserCheck = checkBrowserPackage(environment)

  if ('problem' in browserCheck) {
    return { exitCode: 2, stdout: '', stderr: browserCheck.problem }
  }

  const config = await loadConfig(loadConfigOptionsOf(options, ci, cwd))
  const insideContainer = insideContainerOf(cliOptions, environment)
  const placement = await placeAndProbe(config, browserCheck.browserPackage, insideContainer, cliOptions)

  if ('problem' in placement) {
    return { exitCode: 2, stdout: '', stderr: placement.problem }
  }

  const checks = await checkStorybooks(config.storybooks, cwd)
  const warnings = checks.warnings.map((warning) => `${warning}\n`).join('')

  if ('problems' in checks) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${warnings}${checks.problems.map((problem) => `${problem}\n`).join('')}`,
    }
  }

  const result = await runSnapshots({
    command,
    version: readVersion(),
    config,
    place: placement.place,
    browserPackage: browserCheck.browserPackage,
    selections: checks.storybooks.map(({ storybook, stories }) => ({
      storybook,
      stories: selectStories(stories, options.selection),
    })),
    cwd,
    insideContainer,
    launchBrowser: cliOptions.launchBrowser ?? launchBrowser,
    progress: cliOptions.progress ?? (() => undefined),
  })

  return { ...result, stderr: `${warnings}${result.stderr}` }
}

/**
 * Whether the run is inside a container: the option when a test gives it, else what the environment and the root's
 * marker files say.
 */
function insideContainerOf(cliOptions: RunCliOptions, environment: Record<string, string | undefined>): boolean {
  return cliOptions.insideContainer ?? isInsideContainer(environment)
}

/**
 * Decides where the run's browser runs and, when that is visual-check's container, runs the Docker probe. Inside
 * visual-check's image no Docker is used, so the probe doesn't run. Gives the place, or what to print when the browser
 * has no place to run or Docker can't run it.
 *
 * @throws {Error} Any error the probe throws besides a `ContainerError`.
 */
async function placeAndProbe(
  config: ResolvedConfig,
  browserPackage: BrowserPackage,
  insideContainer: boolean,
  cliOptions: RunCliOptions,
): Promise<{ place: BrowserPlace } | { problem: string }> {
  const placement = placeBrowser(config.platform, browserPackage, cliOptions.imageMarkerPath ?? imageMarkerPath)

  if ('problem' in placement) {
    return { problem: `${placement.problem}\n` }
  }

  if (placement.place.in === 'image') {
    return placement
  }

  try {
    await (cliOptions.probeDocker ?? probeDocker)()

    return placement
  } catch (error) {
    if (error instanceof ContainerError) {
      return { problem: dockerProblemOf(error, { insideContainer, image: runImageOf(browserPackage, config.image) }) }
    }

    throw error
  }
}

/**
 * Builds the options for `loadConfig`, leaving out each flag that isn't given.
 */
function loadConfigOptionsOf(options: RunOptions, ci: boolean, cwd: string): LoadConfigOptions {
  return {
    cwd,
    ci,
    ...(options.config === undefined ? {} : { path: options.config }),
    ...(options.storybook === undefined ? {} : { storybook: options.storybook }),
    ...(options.url === undefined ? {} : { url: options.url }),
  }
}

/**
 * Reads the version from the package's `package.json`.
 */
function readVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }

  return manifest.version
}

/**
 * Builds the result for a problem: the message on standard error, exit code 2.
 */
function failure(message: string): CliResult {
  return { exitCode: 2, stdout: '', stderr: `${message}\n` }
}
