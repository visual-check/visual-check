/**
 * The line Linux's dynamic loader prints when a program links against a shared library the machine lacks, with the
 * library's file name captured, such as `libnss3.so` or `libatk-1.0.so.0`.
 */
const loaderLinePattern = /error while loading shared libraries: ([^:\s]+): cannot open shared object file/

/**
 * Gives the shared library the browser's output says is missing, from the first line where Linux's dynamic loader says
 * it can't load one, or `undefined` when no line says so.
 */
export function missingLibraryOf(output: readonly string[]): string | undefined {
  for (const line of output) {
    const library = loaderLinePattern.exec(line)?.[1]

    if (library !== undefined) {
      return library
    }
  }

  return undefined
}
