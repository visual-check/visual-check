import { type Instance, render } from 'ink'
import type { RunReporter } from '../reporter/run-event.js'
import { LiveScreen } from './live-screen.js'
import { initialLiveViewState, liveViewStateOf } from './live-view-state.js'
import { colourEnabledOf, ThemeContext } from './theme.js'

/**
 * What `startLiveView` takes.
 */
interface LiveViewOptions {
  /**
   * The environment, which turns colour off with `NO_COLOR` or `FORCE_COLOR=0`.
   */
  environment: NodeJS.ProcessEnv
  /**
   * Where the view is drawn: a TTY.
   */
  stdout: NodeJS.WritableStream
  /**
   * Whether every frame is written in full after the one before, instead of drawn over it, so a test can read each.
   * `false` by default.
   */
  debug?: boolean
  /**
   * Gives how long the run has taken so far, in ms, which the progress line shows.
   */
  elapsedMs: () => number
}

/**
 * Starts the `live` reporter, which draws a `test` or `update` run's progress stream in the terminal. It draws nothing
 * until the run is planned, so what the run writes before, such as an image pull's progress on stderr, never mixes with
 * it. Then it prints the header and a shard's notes, then each `✗` and `!` line as its snapshot finishes, above one
 * progress line: a spinner, the snapshots done of the total, the workers and the time taken, redrawn every second.
 * Passes print nothing. `finish` removes the progress line, keeps the printed lines, and hands the terminal back; it
 * never rejects. With `--reporter live` and no TTY it still draws as in one: erase sequences and spinner frames,
 * wrapped at 80 columns.
 *
 * @public
 */
export function startLiveView(options: LiveViewOptions): RunReporter {
  let state = initialLiveViewState
  let instance: Instance | undefined
  const colour = colourEnabledOf(options.environment)

  /**
   * Draws the state as it is now, the first time once the run is planned.
   */
  const draw = (): void => {
    const tree = (
      <ThemeContext value={{ colour }}>
        <LiveScreen elapsedMs={options.elapsedMs} state={state} />
      </ThemeContext>
    )

    if (instance !== undefined) {
      instance.rerender(tree)

      return
    }

    if (state.planned) {
      instance = render(tree, {
        stdout: options.stdout,
        patchConsole: false,
        // The caller decided there's a terminal. Ink's own guess also looks for CI variables, and would draw nothing
        // until the end.
        interactive: true,
        debug: options.debug ?? false,
      })
    }
  }

  return {
    event(event) {
      state = liveViewStateOf(state, event)
      draw()
    },
    async finish() {
      if (instance === undefined) {
        return
      }

      try {
        state = { ...state, closed: true }
        draw()
        await instance.waitUntilRenderFlush()
        // Ink ends even an empty frame with a newline; clearing it leaves no blank line where the progress line was.
        instance.clear()
      } catch {
        // Ending the view never fails the run: the lines it printed stay, and the terminal is handed back below.
      } finally {
        instance.unmount()
      }

      await instance.waitUntilExit().catch(() => undefined)
    },
  }
}
