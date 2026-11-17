/**
 * How a setup step ended: it did what it set out to, it did but gave a warning, or it failed.
 *
 * @public
 */
export type StepOutcome = 'done' | 'warned' | 'failed'

/**
 * Reports the steps `init` takes after its questions, one at a time, in the order it takes them.
 *
 * @public
 */
export interface SetupProgress {
  /**
   * Tells every step that is coming, by title and in order, before the first one starts.
   */
  plan(titles: readonly string[]): void
  /**
   * Starts a step. Steps start in the order of the plan, one at a time. `command` is the command line the step runs, as
   * shown to the user.
   */
  start(title: string, command?: string): void
  /**
   * Passes on what the running step's command wrote, as it arrives. It always belongs to the running step.
   */
  output(text: string): void
  /**
   * Ends the running step. No step starts after a failed one.
   */
  end(outcome: StepOutcome): void
}

/**
 * Makes a `SetupProgress` that writes plain text: `Running <command>` when a step with a command starts, and the
 * command's output as it arrives. It writes nothing for the plan, for a step without a command, or for an end.
 *
 * @public
 */
export function plainSetupProgress(write: (text: string) => void): SetupProgress {
  return {
    plan: () => undefined,
    start: (_title, command) => {
      if (command !== undefined) {
        write(`Running ${command}\n`)
      }
    },
    output: write,
    end: () => undefined,
  }
}

/**
 * Runs a step: starts it, runs `run`, and ends it with the outcome `outcomeOf` gives for the result. A step whose `run`
 * throws or rejects ends `failed`, and the error is rethrown.
 */
export async function runStep<T>(
  progress: SetupProgress,
  step: { title: string; command?: string },
  run: () => T | Promise<T>,
  outcomeOf: (result: T) => StepOutcome,
): Promise<T> {
  progress.start(step.title, step.command)

  let result: T

  try {
    result = await run()
  } catch (error) {
    progress.end('failed')

    throw error
  }

  progress.end(outcomeOf(result))

  return result
}
