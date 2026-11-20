import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The CLI package's own copy of the agent skill, which `init` installs and local runs refresh from. It ships beside
 * `dist/`, so the path is the same from `src/` and `dist/`.
 *
 * @public
 */
export const skillSourcePaths = (() => {
  const folder = fileURLToPath(new URL('../../skill/', import.meta.url))

  return {
    /**
     * The template of `SKILL.md`, whose version line holds a placeholder.
     */
    markdown: join(folder, 'SKILL.md'),
    /**
     * The runner script, copied as it is.
     */
    script: join(folder, 'scripts', 'run.mjs'),
  }
})()

/**
 * The frontmatter line that names the CLI version that wrote the skill: its indent and key, then the value.
 */
const versionLine = /^([ \t]+visual-check-version:[ \t]*)([^\r\n]*)$/m

/**
 * Gives `SKILL.md` from its template, with `metadata.visual-check-version` set to `version`, quoted.
 *
 * @throws {Error} When the template has no version line.
 * @public
 */
export function skillMarkdownOf(template: string, version: string): string {
  if (!versionLine.test(template)) {
    throw new Error("The agent skill's SKILL.md template has no visual-check-version line.")
  }

  return template.replace(versionLine, `$1${JSON.stringify(version)}`)
}

/**
 * Reads the CLI version that wrote an installed `SKILL.md`: `metadata.visual-check-version` in its frontmatter, with
 * its quotes taken off. `undefined` when there's no frontmatter or no such line.
 *
 * @public
 */
export function skillVersionOf(markdown: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1]
  const match = frontmatter === undefined ? undefined : versionLine.exec(frontmatter)

  if (!match) {
    return undefined
  }

  const raw = match[2]?.trim() ?? ''
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(raw)

  return (quoted?.[1] ?? quoted?.[2] ?? raw) || undefined
}
