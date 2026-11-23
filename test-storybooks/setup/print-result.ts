// How the Setup and no-framework checks print a result: one line marked passed or failed, then its problems.

/**
 * Prints one line for a step, marked passed or failed, with how long it took, then each of its problems, every line
 * indented.
 */
export function printResult(name: string, seconds: number, problems: readonly string[]): void {
  console.log(
    [
      `${problems.length === 0 ? '✓' : '✗'} ${name} (${seconds.toFixed(1)} s)`,
      ...problems.map((problem) => `    ${problem.replaceAll('\n', '\n    ')}`),
    ].join('\n'),
  )
}
