import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { listOf } from './list-of.js'
import { isJsonObject } from './package-manager.js'

/**
 * A package that code imports and `package.json` doesn't list.
 */
export interface UnlistedDependency {
  /**
   * The package's name.
   */
  name: string
  /**
   * The files that import it, relative to the project root.
   */
  paths: string[]
}

/**
 * Finds the unlisted dependencies of the project at `root`. It throws when Fallow can't run.
 *
 * @public
 */
export type FindUnlistedDependencies = (root: string) => Promise<UnlistedDependency[]>

/**
 * `execFile` that returns a promise.
 */
const execFileAsync = promisify(execFile)

/**
 * The most output Fallow may write, in bytes.
 */
const maxOutputBytes = 256 * 1024 * 1024

/**
 * The longest Fallow may run, in milliseconds.
 */
const timeoutMs = 120_000

/**
 * Reads one entry of Fallow's `unlisted_dependencies` array. An entry that isn't a package name with at least one
 * importing file throws.
 */
function unlistedDependencyOf(entry: unknown): UnlistedDependency {
  if (!isJsonObject(entry) || typeof entry.package_name !== 'string' || !Array.isArray(entry.imported_from)) {
    throw new Error("Fallow's output holds an unlisted dependency in a shape visual-check can't read.")
  }

  const paths = entry.imported_from.map((site: unknown) => (isJsonObject(site) ? site.path : undefined))

  if (paths.length === 0 || !paths.every((path) => typeof path === 'string')) {
    throw new Error("Fallow's output holds an unlisted dependency without the files that import it.")
  }

  return { name: entry.package_name, paths }
}

/**
 * Reads the unlisted dependencies from the document `fallow dead-code --format json` prints.
 *
 * @throws {Error} When the document has no `unlisted_dependencies` array, or an entry is malformed.
 */
export function unlistedDependenciesOf(document: unknown): UnlistedDependency[] {
  if (!isJsonObject(document) || !Array.isArray(document.unlisted_dependencies)) {
    throw new Error("Fallow's output has no unlisted_dependencies list.")
  }

  return document.unlisted_dependencies.map(unlistedDependencyOf)
}

/**
 * What `execFile` rejects with when the process exits with a code, is killed or can't start.
 */
interface ExecFailure {
  /**
   * What the process wrote to stdout.
   */
  stdout?: string
  /**
   * What the process wrote to stderr.
   */
  stderr?: string
  /**
   * The exit code, or a code such as `ENOENT` when the process didn't start.
   */
  code?: number | string
  /**
   * Whether the timeout killed the process.
   */
  killed?: boolean
  /**
   * The failure's message.
   */
  message?: string
}

/**
 * What a run of Fallow gave.
 */
interface FallowRun {
  /**
   * What Fallow wrote to stdout.
   */
  stdout: string
  /**
   * Why the run failed, as one line, or `undefined` when it exited 0.
   */
  failure: string | undefined
}

/**
 * Words why a failed run failed: the timeout, Fallow's first line of stderr, or its exit code.
 */
export function fallowFailureOf({ stderr = '', code, killed, message }: ExecFailure): string {
  if (killed === true) {
    return `Fallow didn't finish within ${timeoutMs / 1000} s.`
  }

  const firstLine = stderr.split('\n').find((line) => line.trim() !== '')

  return firstLine?.trim() ?? (typeof code === 'number' ? `exit code ${code}` : (message ?? 'it failed'))
}

/**
 * Runs Fallow's dead code check for unlisted dependencies. Fallow exits 1 when it finds anything, so a failing exit
 * still gives its output.
 */
async function runFallow(root: string): Promise<FallowRun> {
  const bin = createRequire(import.meta.url).resolve('fallow/bin/fallow')
  const args = [bin, 'dead-code', '--unlisted-deps', '--format', 'json', '--no-cache', '--root', root]

  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: root,
      maxBuffer: maxOutputBytes,
      timeout: timeoutMs,
      windowsHide: true,
    })

    return { stdout, failure: undefined }
  } catch (error) {
    const failure = error as ExecFailure

    return { stdout: failure.stdout ?? '', failure: fallowFailureOf(failure) }
  }
}

/**
 * Parses what Fallow wrote to stdout.
 *
 * @throws {Error} With `failure` when the text isn't JSON, or with a generic message when Fallow gave no failure.
 */
function documentOf(stdout: string, failure: string | undefined): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(failure ?? "Fallow's output isn't JSON.")
  }
}

/**
 * Asks Fallow for the packages the project's code imports that `package.json` doesn't list. It runs with `--no-cache`,
 * so Fallow writes no `.fallow/` folder into the project.
 *
 * @throws {Error} With Fallow's own error message when it prints one as JSON, else with its first line of stderr, its
 * exit code or the timeout when its output isn't JSON.
 *
 * @public
 */
export const findUnlistedDependencies: FindUnlistedDependencies = async (root) => {
  const { stdout, failure } = await runFallow(root)
  const document = documentOf(stdout, failure)

  if (isJsonObject(document) && document.error === true && typeof document.message === 'string') {
    throw new Error(document.message)
  }

  return unlistedDependenciesOf(document)
}

/**
 * Words the warning for unlisted dependencies, or gives `undefined` when there are none.
 */
export function unlistedDependenciesWarningOf(unlisted: readonly UnlistedDependency[]): string | undefined {
  if (unlisted.length === 0) {
    return undefined
  }

  const [first] = unlisted

  if (unlisted.length === 1 && first !== undefined) {
    return (
      `Warning: package.json doesn't list ${first.name}, imported in ${first.paths[0]}. ` +
      "visual-check can't tell which stories it affects."
    )
  }

  const names = listOf(unlisted.map(({ name }) => name))

  return (
    `Warning: package.json doesn't list ${names}, which your code imports. ` +
    "visual-check can't tell which stories they affect."
  )
}

/**
 * Words the warning for a Fallow that couldn't run.
 */
export function fallowFailureWarningOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  return `Warning: Fallow couldn't check the imports: ${message}`
}
