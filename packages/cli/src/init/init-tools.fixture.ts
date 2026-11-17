import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listProjectFiles } from './find-storybooks.js'
import { defaultsPrompter } from './prompter.js'
import type { RunCommand } from './run-command.js'
import type { InitTools } from './run-init.js'
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
 * What `init` prints on stdout for the files it writes in the pnpm project.
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
   * The progress written, in order.
   */
  progress: string[]
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
 * Builds the tools of a run: `--yes`, no terminal, Node 22 on Linux, the real git file list, the defaults prompter, and
 * fakes for Docker, the commands and Fallow, behaving as `behaviour` says. `overrides` replaces any of them. Gives the
 * tools with what the fakes see.
 */
export function toolsOf(
  overrides: Partial<InitTools> = {},
  behaviour: FakeBehaviour = {},
): { tools: InitTools; record: FakeRecord } {
  const record: FakeRecord = { commands: [], progress: [], probes: 0, fallowRoots: [] }
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
    progress: (text) => {
      record.progress.push(text)
    },
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
