// What the no-framework check expects of `@visual-check/storybook` installed alone, in a project with no React, Vue or
// Angular: no framework comes with it, its root entry imports, and each framework's entry fails only because that
// framework is missing.

/**
 * An entry of `@visual-check/storybook` a project imports.
 */
export interface PackageEntry {
  /**
   * What a project imports, such as `@visual-check/storybook/react`.
   */
  specifier: string
  /**
   * The framework whose absence must be the only reason the entry fails to import. None for the root entry, which must
   * import.
   */
  framework?: string
}

/**
 * The frameworks none of which may resolve from the installed package.
 */
const frameworks = ['react', 'react-dom', 'vue', '@angular/core', '@angular/common']

/**
 * The entries the check imports, each in a process of its own.
 */
export const packageEntries: PackageEntry[] = [
  { specifier: '@visual-check/storybook' },
  { specifier: '@visual-check/storybook/react', framework: 'react' },
  { specifier: '@visual-check/storybook/vue', framework: 'vue' },
  // Node reports the port's first import, so the Angular entry fails on `@angular/common` before `@angular/core`.
  { specifier: '@visual-check/storybook/angular', framework: '@angular/common' },
]

/**
 * How a Node process that imported an entry ended.
 */
export interface ImportRun {
  /**
   * The exit code, or null when a signal ended it.
   */
  status: number | null
  /**
   * Its standard error.
   */
  stderr: string
}

/**
 * The non-empty lines of a process's output.
 */
function linesOf(output: string): string[] {
  return output.split('\n').filter((line) => line.trim() !== '')
}

/**
 * The problems with how importing an entry went: the root entry must import, and a framework's entry must fail with
 * `ERR_MODULE_NOT_FOUND` for that framework, so a missing export or another missing package doesn't pass.
 */
export function importProblemsOf(entry: PackageEntry, run: ImportRun): string[] {
  const { framework, specifier } = entry

  if (framework === undefined) {
    if (run.status === 0) {
      return []
    }

    return [`${specifier} didn't import: ${linesOf(run.stderr).at(-1) ?? `exit ${run.status}`}`]
  }

  if (run.status === 0) {
    return [`${specifier} imported, but should fail without ${framework}`]
  }

  if (run.stderr.includes('ERR_MODULE_NOT_FOUND') && run.stderr.includes(`Cannot find package '${framework}'`)) {
    return []
  }

  const errorLine = linesOf(run.stderr).find((line) => line.includes('Error')) ?? `exit ${run.status}`

  return [`${specifier} failed for another reason than a missing ${framework}: ${errorLine}`]
}

/**
 * The frameworks that resolve, each a problem. `resolve` resolves a specifier from the installed package, throwing
 * when it can't. A framework is absent only when it throws `MODULE_NOT_FOUND`: another code, such as
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, means the package is there.
 */
export function frameworkProblemsOf(resolve: (specifier: string) => void): string[] {
  return frameworks.flatMap((framework) => {
    try {
      resolve(`${framework}/package.json`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        return []
      }
    }

    return [`${framework} is installed`]
  })
}
