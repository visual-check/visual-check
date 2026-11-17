import { relative, sep } from 'node:path'

/**
 * Writes a path relative to `folder`, such as the folder the CLI runs in or the config's, with `/` on every OS.
 *
 * @public
 */
export function displayPathOf(folder: string, path: string): string {
  return relative(folder, path).split(sep).join('/')
}
