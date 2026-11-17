import { Box, Text } from 'ink'
import { type ReactNode, useEffect, useState } from 'react'
import type { StepOutcome } from '../init/setup-progress.js'
import { ColouredText } from './coloured-text.js'
import type { SetupStep } from './init-view-state.js'
import { type OutputTail, shownLinesOf } from './output-tail.js'
import { ProgressBar } from './progress-bar.js'
import { Spinner } from './spinner.js'
import { type Colour, glyphs } from './theme.js'

/**
 * What `StepList` takes.
 */
interface StepListProps {
  /**
   * The steps, in the order of the plan.
   */
  steps: readonly SetupStep[]
  /**
   * When the plan was given, in milliseconds since the epoch.
   */
  startedAt: number
  /**
   * Tells the time now, in milliseconds since the epoch, as `Date.now` does.
   */
  clock: () => number
}

/**
 * What `StepLine` takes.
 */
interface StepLineProps {
  /**
   * The step to draw.
   */
  step: SetupStep
  /**
   * The time now, in milliseconds since the epoch, which a running step's duration counts up to.
   */
  now: number
}

/**
 * What `StepRow` takes.
 */
interface StepRowProps {
  /**
   * The glyph before the title, already styled.
   */
  glyph: ReactNode
  /**
   * The title, already styled, as text.
   */
  title: ReactNode
  /**
   * How long the step has taken, once it has started, as `durationOf` words it.
   */
  duration?: string
}

/**
 * What `OutputLines` takes.
 */
interface OutputLinesProps {
  /**
   * The end of the step's command's output.
   */
  output: OutputTail
  /**
   * The most lines to show.
   */
  count: number
}

/**
 * How a step that ended is drawn.
 */
interface EndedLook {
  /**
   * The glyph before its title.
   */
  glyph: string
  /**
   * The colour of the glyph and the title.
   */
  colour: Colour
}

/**
 * How often the durations count up while a step runs.
 */
const tickMilliseconds = 1000

/**
 * The most lines of a running step's output the list shows.
 */
const runningLineCount = 3

/**
 * The most lines of a failed step's output the list keeps, so the person sees why it failed.
 */
const failedLineCount = 15

/**
 * How each way a step can end is drawn: a check in the accent colour, a triangle in the caution colour, or a cross in
 * the danger colour.
 */
const endedLooks: Record<StepOutcome, EndedLook> = {
  done: { glyph: glyphs.passed, colour: 'accent' },
  warned: { glyph: glyphs.caution, colour: 'caution' },
  failed: { glyph: glyphs.failed, colour: 'danger' },
}

/**
 * Words a duration: tenths of a second under 10 s (`0.4s`), whole seconds under a minute (`12s`), then minutes and
 * two-digit seconds (`1m 05s`). Each part is rounded down, as a clock counts, and less than nothing counts as nothing.
 */
export function durationOf(milliseconds: number): string {
  const tenths = Math.floor(Math.max(milliseconds, 0) / 100)

  if (tenths < 100) {
    return `${(tenths / 10).toFixed(1)}s`
  }

  const seconds = Math.floor(tenths / 10)

  if (seconds < 60) {
    return `${seconds}s`
  }

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * How long the steps have taken since the plan: up to `now` while one runs, else up to the last time one ended, so the
 * total stops when the work does.
 */
export function elapsedOf(steps: readonly SetupStep[], startedAt: number, now: number): number {
  if (steps.some((step) => step.state === 'running')) {
    return now - startedAt
  }

  return Math.max(startedAt, ...steps.map((step) => step.endedAt ?? startedAt)) - startedAt
}

/**
 * Gives the time `clock` tells, and draws again every second while `ticking`, so a running step's duration counts up.
 * The timer stops once nothing ticks, and when the component unmounts.
 */
function useNow(clock: () => number, ticking: boolean): number {
  const [, setTicks] = useState(0)

  useEffect(() => {
    if (!ticking) {
      return undefined
    }

    const timer = setInterval(() => {
      setTicks((previous) => previous + 1)
    }, tickMilliseconds)

    return () => {
      clearInterval(timer)
    }
  }, [ticking])

  return clock()
}

/**
 * The last `count` lines of a step's output, dim, each under `│ ` and cut at the terminal's edge rather than wrapped,
 * so the list keeps its height while the output changes.
 */
function OutputLines({ output, count }: OutputLinesProps): ReactNode {
  const lines = shownLinesOf(output, count)

  if (lines.length === 0) {
    return null
  }

  return (
    <Box marginLeft={2}>
      {/* Ink cuts each line of the text on its own. */}
      <Text dimColor wrap="truncate-end">
        {lines.map((line) => `│ ${line}`).join('\n')}
      </Text>
    </Box>
  )
}

/**
 * Lays out a step's line: the glyph, then the title with how long the step has taken after it, dim, once it has
 * started. The title wraps under itself, not under the glyph, and the duration never splits across lines.
 */
function StepRow({ glyph, title, duration }: StepRowProps): ReactNode {
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        {glyph}
      </Box>
      <Text>
        {title}
        {/* A no-break space inside the duration keeps `1m 05s` together. */}
        {duration === undefined ? null : <Text dimColor>{` ${duration.replaceAll(' ', '\u00a0')}`}</Text>}
      </Text>
    </Box>
  )
}

/**
 * Draws one step. A pending one is dim after `○`, and a skipped one dim after `−`, with the word skipped. A running one
 * turns the spinner before its title and counts its duration, with its command and the last three lines of its output
 * under it. One that ended takes its outcome's glyph and colour and how long it took, and one that failed keeps the last
 * 15 lines of its output.
 */
function StepLine({ step, now }: StepLineProps): ReactNode {
  if (step.state === 'pending') {
    return <StepRow glyph={<Text dimColor>{glyphs.pending}</Text>} title={<Text dimColor>{step.title}</Text>} />
  }

  if (step.state === 'skipped') {
    return (
      <StepRow glyph={<Text dimColor>{glyphs.skipped}</Text>} title={<Text dimColor>{`${step.title} skipped`}</Text>} />
    )
  }

  const duration = durationOf((step.endedAt ?? now) - (step.startedAt ?? now))

  if (step.state === 'running') {
    return (
      <Box flexDirection="column">
        <StepRow duration={duration} glyph={<Spinner />} title={step.title} />
        {step.command === undefined ? null : (
          <Box marginLeft={2}>
            <Text dimColor wrap="truncate-end">
              {step.command}
            </Text>
          </Box>
        )}
        <OutputLines count={runningLineCount} output={step.output} />
      </Box>
    )
  }

  const { glyph, colour } = endedLooks[step.state]

  return (
    <Box flexDirection="column">
      <StepRow
        duration={duration}
        glyph={<ColouredText colour={colour}>{glyph}</ColouredText>}
        title={<ColouredText colour={colour}>{step.title}</ColouredText>}
      />
      {step.state === 'failed' ? <OutputLines count={failedLineCount} output={step.output} /> : null}
    </Box>
  )
}

/**
 * The setup steps after a blank line: a bar of how many have ended and how long they have taken, then each step in
 * the order of the plan. While a step runs, the durations count up every second.
 */
export function StepList({ steps, startedAt, clock }: StepListProps): ReactNode {
  const running = steps.some((step) => step.state === 'running')
  const now = useNow(clock, running)
  const ended = steps.filter((step) => Object.hasOwn(endedLooks, step.state)).length

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <ProgressBar done={ended} total={steps.length} />
        <Text dimColor>{` ${glyphs.hint} ${durationOf(elapsedOf(steps, startedAt, now))}`}</Text>
      </Text>
      {steps.map((step) => (
        <StepLine key={step.id} now={now} step={step} />
      ))}
    </Box>
  )
}
