import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'

/**
 * Whether the project can hold a file with `"` in its name. Windows can't.
 */
const quotesInNames = process.platform !== 'win32'

/**
 * The file the project's own `.fallowrc.json` ignores.
 */
export const ignoredFile = 'src/ignored.ts'

/**
 * The file with `"` in its name, which the project holds only where names can have quotes.
 */
export const quotedFile = 'src/q"uote.ts'

/**
 * The project's source files as `test/fixtures/fallow-project.json` holds them: `files` maps each path relative to the root
 * to its content, and `withoutQuotedNames` overrides those where names can't hold `"`, a `null` dropping the file. They
 * live in JSON, not in this file, because the re-exports and imports in them are text, and a re-export in a `.ts`
 * file is a layout problem. They cover paths that need escapes, a re-export chain, a cycle, Storybook's config files, a
 * stories file and a file nothing imports.
 */
const projectData = JSON.parse(
  readFileSync(new URL('../../test/fixtures/fallow-project.json', import.meta.url), 'utf8'),
) as {
  files: Record<string, string>
  withoutQuotedNames: Record<string, string | null>
}

/**
 * The project's source files, each a path relative to the root mapped to its content.
 */
const sourceFiles: Record<string, string> = Object.fromEntries(
  Object.entries({ ...projectData.files, ...(quotesInNames ? {} : projectData.withoutQuotedNames) }).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  ),
)

/**
 * The paths of the project's source files, relative to its root.
 */
export const projectSourceFiles: readonly string[] = Object.keys(sourceFiles)

/**
 * Writes `content` at `path`, creating the parent folders.
 */
function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * Keeps the real Fallow runs in the tests off the system's certificate store. Fallow's Node launcher loads `https`, and
 * with `NODE_USE_SYSTEM_CA` set, Node then reads the system's certificates, which on macOS a daemon hands out to one
 * process at a time: queued behind the other test files' Node processes, a run that takes 0.2 s took seconds. The tests
 * fetch nothing. It stubs `process.env`, which Fallow inherits, so `vi.unstubAllEnvs` undoes it.
 */
export function keepFallowOffSystemCertificates(): void {
  vi.stubEnv('NODE_USE_SYSTEM_CA', undefined)
}

/**
 * Makes a temporary project for Fallow to read and returns its real path. Its own `.fallowrc.json` ignores
 * `ignoredFile`. It has no `node_modules`, which Fallow warns about and reads past. The caller removes the folder.
 */
export function makeFallowProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-fallow-')))

  writeFile(join(root, 'package.json'), '{ "name": "fallow-project", "private": true, "type": "module" }\n')
  writeFile(join(root, '.fallowrc.json'), `{ "ignorePatterns": ["${ignoredFile}"] }\n`)
  for (const [path, content] of Object.entries(sourceFiles)) {
    writeFile(join(root, path), content)
  }

  return root
}
