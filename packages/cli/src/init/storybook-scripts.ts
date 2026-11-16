import { posix } from 'node:path'

/**
 * One `storybook dev` or `storybook build` call found in a script.
 */
export interface StorybookCall {
  /**
   * The name of the script that holds the call.
   */
  script: string
  /**
   * Which command the call runs.
   */
  subcommand: 'dev' | 'build'
  /**
   * The call's `-c` or `--config-dir` folder: posix, with no leading `./` and no trailing `/`, and `.` for the project
   * root. `undefined` without one, which means `.storybook`.
   */
  configDir: string | undefined
  /**
   * The port the call serves on, from `-p`, `--port`, `SBCONFIG_PORT` or `PORT`. `undefined` when none is set or it
   * isn't a port.
   */
  port: number | undefined
}

/**
 * The config folder Storybook reads when a call names none.
 */
export const defaultConfigDir = '.storybook'

/**
 * The shell operators that end one command and start the next.
 */
const commandSeparator = /&&|\|\||[;|&]/

/**
 * Returns the config folder a call uses: its own, or `.storybook`.
 */
export function configDirOf(call: StorybookCall): string {
  return call.configDir ?? defaultConfigDir
}

/**
 * Splits a segment into words. A quoted string stays in one word, and the quotes are removed.
 */
function tokensOf(segment: string): string[] {
  const words = segment.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? []

  return words.map((word) => word.replace(/"([^"]*)"|'([^']*)'/g, '$1$2'))
}

/**
 * Whether a word runs the `storybook` binary: its last path part, without a `@version`, is `storybook`. So
 * `./node_modules/.bin/storybook` and `storybook@10` count.
 */
function isStorybookToken(token: string): boolean {
  return posix.basename(token).replace(/@.*$/, '') === 'storybook'
}

/**
 * Returns a whole number from 1 to 65535 as a number. Anything else gives `undefined`.
 */
function portOf(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+$/.test(text)) {
    return undefined
  }

  const port = Number(text)

  return port >= 1 && port <= 65535 ? port : undefined
}

/**
 * Returns the value of the first of `flags` in `tokens`, either as `--flag value` or as `--flag=value`.
 */
function flagValueOf(tokens: readonly string[], flags: readonly string[]): string | undefined {
  for (const [index, token] of tokens.entries()) {
    for (const flag of flags) {
      if (token === flag) {
        return tokens[index + 1]
      }

      if (token.startsWith(`${flag}=`)) {
        return token.slice(flag.length + 1)
      }
    }
  }

  return undefined
}

/**
 * Returns the value of the environment assignment `name=<value>` among the tokens before `storybook`.
 */
function envValueOf(tokens: readonly string[], name: string): string | undefined {
  return tokens.find((token) => token.startsWith(`${name}=`))?.slice(name.length + 1)
}

/**
 * Cleans up a config folder: posix, with no leading `./` and no trailing `/`. The project root, in any spelling (`.`,
 * `./` or empty), is `.`. Without a folder, gives `undefined`.
 */
function normalizeConfigDir(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined
  }

  return posix.normalize(text.replace(/\\/g, '/')).replace(/(?<=.)\/+$/, '')
}

/**
 * Finds the port of a call. The flag on the call comes first, then `SBCONFIG_PORT`, then `PORT`.
 */
function portOfCall(before: readonly string[], after: readonly string[]): number | undefined {
  return (
    portOf(flagValueOf(after, ['-p', '--port'])) ??
    portOf(envValueOf(before, 'SBCONFIG_PORT')) ??
    portOf(envValueOf(before, 'PORT'))
  )
}

/**
 * Reads the Storybook call of one command, or `undefined` when it has none. The call is the word `storybook` followed
 * by `dev` or `build`.
 */
function callOfSegment(script: string, segment: string): StorybookCall | undefined {
  const tokens = tokensOf(segment)
  const index = tokens.findIndex(
    (token, position) =>
      isStorybookToken(token) && (tokens[position + 1] === 'dev' || tokens[position + 1] === 'build'),
  )

  if (index === -1) {
    return undefined
  }

  const after = tokens.slice(index + 1)

  return {
    script,
    subcommand: after[0] === 'build' ? 'build' : 'dev',
    configDir: normalizeConfigDir(flagValueOf(after, ['-c', '--config-dir'])),
    port: portOfCall(tokens.slice(0, index), after),
  }
}

/**
 * Finds every `storybook dev` and `storybook build` call in the scripts, in script order. A script chaining commands
 * with `&&`, `||`, `;`, `|` or `&` gives one call per command.
 */
export function storybookCallsOf(scripts: Record<string, string>): StorybookCall[] {
  return Object.entries(scripts).flatMap(([script, command]) =>
    command
      .split(commandSeparator)
      .map((segment) => callOfSegment(script, segment))
      .filter((call): call is StorybookCall => call !== undefined),
  )
}

/**
 * Picks the call that starts the Storybook of a config folder: a `storybook dev` call in the script named `storybook`,
 * else in the first script that has one. `storybook build` never starts a Storybook.
 */
export function startScriptOf(calls: readonly StorybookCall[], configDir: string): StorybookCall | undefined {
  const candidates = calls.filter((call) => call.subcommand === 'dev' && configDirOf(call) === configDir)

  return candidates.find((call) => call.script === 'storybook') ?? candidates[0]
}
