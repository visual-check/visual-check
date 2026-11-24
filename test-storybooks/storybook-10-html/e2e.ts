// The end-to-end check of each other port's test Storybook: it serves the static build, runs the built CLI against it,
// and checks that the grid stories, drawn with the port, give the React port's images byte for byte. Its three
// cases: `test --all` passes every grid story against the committed baselines; the committed baselines are
// `storybook-10-react`'s; and `update` into an empty folder writes `storybook-10-react`'s baselines.
//
// It works in the folder it starts in, so each other port's test Storybook runs this same file from its own folder, as
// `node ../storybook-10-html/e2e.ts` from `storybook-9-html`, `storybook-10-vue` or `storybook-10-angular`. Run it
// with `pnpm turbo run e2e --filter <package name>`, which builds the CLI and the Storybook first, with
// TEST_STORYBOOK_IMAGE naming the browser image. It prints one line per case, then each of its problems, and exits 1
// when any case fails. Every run of the CLI is without `CI` in its environment.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, join, resolve } from 'node:path'
import type { TestReport, UpdateReport } from '@visual-check/cli'
import {
  answerWithStaticFile,
  cliBin,
  committedBaselines,
  diagnosticsDir,
  image,
  localEnvironment,
  packageDir,
  runCases,
  withTemporaryFolder,
} from '../storybook-10-react/e2e-support.ts'
import {
  expectedKeysOf,
  sameImagesProblems,
  storybookNameOf,
  testReportProblems,
  updateReportProblems,
} from './e2e-checks.ts'

/**
 * The static Storybook build that `pnpm build-storybook` writes.
 */
const staticDir = join(packageDir, 'storybook-static')

/**
 * The React Storybook's committed baselines, the images each other port's grid stories must give.
 */
const reactBaselines = resolve(packageDir, '..', 'storybook-10-react', '.visual-check', 'baselines')

/**
 * How long a run of the CLI may take before it's killed, in ms.
 */
const cliTimeoutMilliseconds = 300_000

/**
 * How many workers each run of the CLI captures with.
 */
const workers = 2

/**
 * How many of a failed run's last standard error lines a problem quotes.
 */
const stderrLineCount = 20

/**
 * What a finished run of the CLI gave.
 */
interface CliRun {
  /**
   * Its exit code, `null` when a signal ended it.
   */
  exitCode: number | null
  /**
   * The signal that ended it, `null` when it exited. Only the time limit kills it, with `SIGKILL`.
   */
  signal: NodeJS.Signals | null
  /**
   * Everything it wrote to standard output.
   */
  stdout: string
  /**
   * Everything it wrote to standard error.
   */
  stderr: string
}

/**
 * Lists what the check needs and doesn't have: the browser image and the static build.
 */
function findSetupProblems(): string[] {
  const { name } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { name: string }
  const hint = `pnpm turbo run e2e --filter ${name}`

  return [
    ...(image === undefined ? ['TEST_STORYBOOK_IMAGE is not set: name the browser image to run in.'] : []),
    ...(existsSync(join(staticDir, 'index.json')) ? [] : [`storybook-static/ is missing: run ${hint}`]),
  ]
}

/**
 * Serves the static build on a free port, answering each URL path with its file, or 404 when it names none.
 */
async function serveStorybook(): Promise<Server> {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1')

    answerWithStaticFile(staticDir, pathname, response)
  })

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListening)
  })

  return server
}

/**
 * The URL a server answers at.
 */
function urlOf(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * Runs the built CLI in this package's folder with the arguments, without blocking the server, and resolves with what
 * it gave. It is killed when it runs past the time limit.
 */
function runCli(args: string[]): Promise<CliRun> {
  const child = spawn(process.execPath, [cliBin, ...args], {
    cwd: packageDir,
    env: localEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: cliTimeoutMilliseconds,
    killSignal: 'SIGKILL',
  })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  return new Promise((resolveRun, reject) => {
    child.on('error', reject)
    child.on('close', (exitCode, signal) => resolveRun({ exitCode, signal, stdout, stderr }))
  })
}

/**
 * Parses a run's JSON report and gives its problems. When the time limit killed the run, the problem says it timed
 * out, and when standard output holds no report, it quotes the last lines of standard error.
 */
function reportProblemsOf<Report>(command: string, run: CliRun, check: (report: Report) => string[]): string[] {
  if (run.signal !== null) {
    return [`${command} timed out: it ran past its ${cliTimeoutMilliseconds / 1000} s time limit and was killed`]
  }

  let report: Report

  try {
    report = JSON.parse(run.stdout) as Report
  } catch {
    const lastLines = run.stderr.trimEnd().split('\n').slice(-stderrLineCount)

    return [`${command} exited ${run.exitCode} and printed no JSON report. Its standard error ended:`, ...lastLines]
  }

  return check(report)
}

/**
 * Writes a config for this Storybook, named after its folder, served at the URL, with its baselines in the given
 * folder, that captures in the browser image with 2 workers. Gives its path.
 */
function writeConfig(folder: string, url: string, baselines: string): string {
  const path = join(folder, 'visual-check.config.mjs')
  const config = {
    storybooks: { [storybookNameOf(basename(packageDir))]: { url, dir: packageDir, baselines } },
    image,
    workers,
  }

  writeFileSync(path, `export default ${JSON.stringify(config, null, 2)}\n`)

  return path
}

/**
 * Reads every file of a folder, by name, or none when the folder isn't there.
 */
function filesIn(folder: string): Map<string, Uint8Array> {
  if (!existsSync(folder)) {
    return new Map()
  }

  return new Map(readdirSync(folder).map((name) => [name, readFileSync(join(folder, name))]))
}

/**
 * Checks that `test --all` passes every grid story against the committed baselines.
 */
async function checkCommittedBaselines(url: string, keys: string[]): Promise<string[]> {
  const run = await runCli(['test', '--all', '--url', url, '--workers', String(workers), '--reporter', 'json'])

  return reportProblemsOf<TestReport>('test', run, (report) => testReportProblems(report, keys))
}

/**
 * Checks that `update` into an empty folder writes the React Storybook's baselines byte for byte. On any problem it
 * copies the written baselines to the diagnostics folder and names it.
 */
async function checkUpdateWritesReactImages(url: string, keys: string[]): Promise<string[]> {
  rmSync(diagnosticsDir, { recursive: true, force: true })

  return withTemporaryFolder(async (folder) => {
    const baselines = join(folder, 'baselines')
    const config = writeConfig(folder, url, baselines)
    const run = await runCli(['update', '--all', '--config', config, '--reporter', 'json'])
    const problems = [
      ...reportProblemsOf<UpdateReport>('update', run, (report) => updateReportProblems(report, keys)),
      ...sameImagesProblems(keys, filesIn(baselines), filesIn(reactBaselines), 'the written baselines'),
    ]

    if (problems.length > 0 && existsSync(baselines)) {
      mkdirSync(diagnosticsDir, { recursive: true })
      cpSync(baselines, diagnosticsDir, { recursive: true })

      return [...problems, `the written baselines are in ${diagnosticsDir}`]
    }

    return problems
  })
}

const setupProblems = findSetupProblems()

if (setupProblems.length > 0) {
  console.error(setupProblems.join('\n'))
  process.exitCode = 1
} else {
  const keys = expectedKeysOf(JSON.parse(readFileSync(join(packageDir, 'expected-outcomes.json'), 'utf8')))
  const server = await serveStorybook()
  const url = urlOf(server)

  try {
    const passed = await runCases([
      {
        name: 'committed baselines: test --all passes every grid story',
        run: () => checkCommittedBaselines(url, keys),
      },
      {
        name: "the React port's images: the committed baselines are storybook-10-react's, byte for byte",
        run: async () =>
          sameImagesProblems(keys, filesIn(committedBaselines), filesIn(reactBaselines), 'the committed baselines'),
      },
      {
        name: "the React port's images: update into an empty folder writes storybook-10-react's baselines, byte for byte",
        run: () => checkUpdateWritesReactImages(url, keys),
      },
    ])

    process.exitCode = passed ? 0 : 1
  } finally {
    server.closeAllConnections()
    await new Promise((resolveClosed) => server.close(resolveClosed))
  }
}
