import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NextSteps, WrittenList } from './closing-message.js'
import { listProjectFiles } from './find-storybooks.js'
import { defaultsPrompter } from './prompter.js'
import type { RunCommand } from './run-command.js'
import type { InitTools } from './run-init.js'
import type { SetupProgress, StepOutcome } from './setup-progress.js'
import type { UnlistedDependency } from './unlisted-dependencies.js'

/**
 * The CLI's own `package.json`: its version and the browser package's peer range.
 */
const cliManifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
  peerDependencies: { '@visual-check/chromium': string }
}

/**
 * The version of the CLI under test.
 */
export const cliVersion = cliManifest.version

/**
 * The browser package's range the CLI takes.
 */
export const browserRange = cliManifest.peerDependencies['@visual-check/chromium']

/**
 * The dependencies `init` adds to a project that lists none of them, under pnpm.
 *
 * @public
 */
export const pnpmAdd = {
  command: 'pnpm',
  args: [
    'add',
    '--save-dev',
    `@visual-check/cli@${cliVersion}`,
    `@visual-check/chromium@${browserRange}`,
    `@visual-check/storybook@${cliVersion}`,
  ],
}

/**
 * The command that adds the addon to the `.storybook` Storybook, under pnpm.
 */
export const pnpmAddon = {
  command: 'pnpm',
  args: ['exec', 'storybook', 'add', `@visual-check/storybook-addon@${cliVersion}`, '--yes'],
}

/**
 * The `visual-check.ts` `init` writes in each config folder.
 */
export const modesFile = `import { defineVisualCheck } from '@visual-check/storybook'

export const visualCheck = defineVisualCheck({
  modes: {
    // Each mode a story lists adds one snapshot besides its default capture. For example:
    // mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
  },
})
`

/**
 * The `.gitignore` `init` writes in each `.visual-check/` folder.
 */
export const gitignore = '/*\n!/baselines/\n!/.gitignore\n'

/**
 * The closing message for the one Storybook of the pnpm project.
 *
 * @public
 */
export const pnpmClosingMessage = [
  'visual-check is set up. Next:',
  '  1. Start Storybook with pnpm run storybook.',
  '  2. Run pnpm run visual:update to write baselines. The first run downloads the browser image.',
  '  3. Run pnpm run visual:check. It should pass. ' +
    'If a story fails, see https://visual-check.vercel.app/docs/broken-stories.',
  '  4. Commit visual-check.config.ts, .storybook/visual-check.ts and .visual-check/.',
  '',
  'To set options for every story, spread visualCheck into the parameters in .storybook/preview.ts:',
  "  import { visualCheck } from './visual-check'",
  '  parameters: { ...visualCheck({}) },',
  '',
  'To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.',
  '',
].join('\n')

/**
 * What the one Storybook of the pnpm project is told to do next: the closing message as data.
 *
 * @public
 */
export const pnpmNextSteps: NextSteps = {
  steps: [
    ['Start Storybook with ', { code: 'pnpm run storybook' }, '.'],
    ['Run ', { code: 'pnpm run visual:update' }, ' to write baselines. The first run downloads the browser image.'],
    [
      'Run ',
      { code: 'pnpm run visual:check' },
      '. It should pass. If a story fails, see ',
      { code: 'https://visual-check.vercel.app/docs/broken-stories' },
      '.',
    ],
    [
      'Commit ',
      { code: 'visual-check.config.ts' },
      ', ',
      { code: '.storybook/visual-check.ts' },
      ' and ',
      { code: '.visual-check/' },
      '.',
    ],
  ],
  previews: [
    {
      file: '.storybook/preview.ts',
      lines: ["import { visualCheck } from './visual-check'", 'parameters: { ...visualCheck({}) },'],
    },
  ],
  ciUrl: 'https://visual-check.vercel.app/docs/ci',
}

/**
 * What `init` writes in the pnpm project when it holds none of it yet, worded for the person.
 *
 * @public
 */
export const pnpmWrittenList: WrittenList = {
  files: ['visual-check.config.ts', '.storybook/visual-check.ts', '.visual-check/.gitignore'],
  scripts: ['Added the scripts visual:check and visual:update to package.json.'],
}

/**
 * What `init` prints on stdout for the files it writes in the pnpm project.
 *
 * @public
 */
export const pnpmWrittenLines = `Wrote visual-check.config.ts
Wrote .storybook/visual-check.ts
Wrote .visual-check/.gitignore
Added the scripts visual:check and visual:update to package.json.
`

/**
 * A command a fake `RunCommand` was asked to run.
 */
interface RecordedCommand {
  /**
   * The program.
   */
  command: string
  /**
   * The arguments.
   */
  args: readonly string[]
  /**
   * The folder it ran in.
   */
  cwd: string
}

/**
 * A call the fake `SetupProgress` saw: `plan` with the titles, `start` with the title and the command, if any, `output`
 * with the text, or `end` with the outcome.
 */
export type ProgressCall =
  | readonly ['plan', readonly string[]]
  | readonly ['start', string, string?]
  | readonly ['output', string]
  | readonly ['end', StepOutcome]

/**
 * How the fakes behave.
 */
interface FakeBehaviour {
  /**
   * The exit code of each command in turn, 0 once they run out.
   */
  exitCodes?: readonly number[]
  /**
   * Whether a command that succeeds installs what it adds, as a package manager would: it lists each added
   * `@visual-check/*` package in the manifest's `devDependencies`, and puts a stand-in `@visual-check/cli` in
   * `node_modules` so a config can import it.
   */
  installs?: boolean
  /**
   * What the Docker probe rejects with. It resolves a running Linux engine when not given.
   */
  dockerError?: Error
  /**
   * What Fallow finds, or what it throws. Nothing when not given.
   */
  fallow?: UnlistedDependency[] | Error
}

/**
 * What the fakes saw during a run.
 */
interface FakeRecord {
  /**
   * The commands run, in order.
   */
  commands: RecordedCommand[]
  /**
   * The calls to the progress, in order.
   */
  progress: ProgressCall[]
  /**
   * How many times Docker was probed.
   */
  probes: number
  /**
   * The roots Fallow was asked about, in order.
   */
  fallowRoots: string[]
}

/**
 * Installs what a successful add command adds, the way a package manager would: lists each `@visual-check/*` package
 * of the command in the manifest's `devDependencies`, and puts a stand-in `@visual-check/cli` in `node_modules`.
 */
function install(args: readonly string[], cwd: string): void {
  const manifestPath = join(cwd, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { devDependencies?: Record<string, string> }
  const specs = args.filter((arg) => arg.startsWith('@visual-check/'))

  for (const spec of specs) {
    const at = spec.lastIndexOf('@')

    manifest.devDependencies = { ...manifest.devDependencies, [spec.slice(0, at)]: spec.slice(at + 1) }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  if (specs.some((spec) => spec.startsWith('@visual-check/cli@'))) {
    const cliDir = join(cwd, 'node_modules', '@visual-check', 'cli')

    mkdirSync(cliDir, { recursive: true })
    writeFileSync(
      join(cliDir, 'package.json'),
      JSON.stringify({ name: '@visual-check/cli', type: 'module', exports: './index.js' }),
    )
    writeFileSync(join(cliDir, 'index.js'), 'export const defineConfig = (config) => config\n')
  }
}

/**
 * Makes a `SetupProgress` that records each call, with the calls it recorded in order.
 */
export function recordingProgress(): { progress: SetupProgress; calls: ProgressCall[] } {
  const calls: ProgressCall[] = []
  const progress: SetupProgress = {
    plan: (titles) => {
      calls.push(['plan', titles])
    },
    start: (title, command) => {
      calls.push(command === undefined ? ['start', title] : ['start', title, command])
    },
    output: (text) => {
      calls.push(['output', text])
    },
    end: (outcome) => {
      calls.push(['end', outcome])
    },
  }

  return { progress, calls }
}

/**
 * Builds the tools of a run: `--yes`, no terminal, Node 22 on Linux, the real git file list, the defaults prompter, and
 * fakes for Docker, the commands and Fallow, behaving as `behaviour` says. `overrides` replaces any of them. Gives the
 * tools with what the fakes see.
 *
 * @public
 */
export function toolsOf(
  overrides: Partial<InitTools> = {},
  behaviour: FakeBehaviour = {},
): { tools: InitTools; record: FakeRecord } {
  const recording = recordingProgress()
  const record: FakeRecord = { commands: [], progress: recording.calls, probes: 0, fallowRoots: [] }
  const runCommand: RunCommand = (command, args, cwd) => {
    const exitCode = behaviour.exitCodes?.[record.commands.length] ?? 0

    record.commands.push({ command, args, cwd })
    if (exitCode === 0 && behaviour.installs === true) {
      install(args, cwd)
    }

    return Promise.resolve(exitCode)
  }
  const tools: InitTools = {
    yes: true,
    interactive: false,
    nodeVersion: '22.23.1',
    os: 'linux',
    cliVersion,
    browserRange,
    probeDocker: () => {
      record.probes += 1

      return behaviour.dockerError === undefined
        ? Promise.resolve({ cpus: 4, memoryBytes: 2 ** 34, desktop: false })
        : Promise.reject(behaviour.dockerError)
    },
    listFiles: listProjectFiles,
    runCommand,
    findUnlistedDependencies: (root) => {
      record.fallowRoots.push(root)

      return behaviour.fallow instanceof Error
        ? Promise.reject(behaviour.fallow)
        : Promise.resolve(behaviour.fallow ?? [])
    },
    prompter: defaultsPrompter(),
    progress: recording.progress,
    ...overrides,
  }

  return { tools, record }
}

/**
 * Lists the commands as run in `root`.
 */
export function commandsIn(root: string, ...commands: { command: string; args: string[] }[]): RecordedCommand[] {
  return commands.map((command) => ({ ...command, cwd: root }))
}
