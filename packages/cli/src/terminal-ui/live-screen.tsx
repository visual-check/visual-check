import { Static, Text } from 'ink'
import { type ReactNode, useEffect, useState } from 'react'
import type { SnapshotMark } from '../reporter/run-event.js'
import { ColouredText } from './coloured-text.js'
import { type LiveViewState, progressLineOf } from './live-view-state.js'
import { Spinner } from './spinner.js'
import type { Colour } from './theme.js'

/**
 * How often the progress line's time taken is redrawn.
 */
const tickMilliseconds = 1000

/**
 * The colour each snapshot mark is drawn in.
 */
const markColours: Record<SnapshotMark, Colour> = {
  '✓': 'accent',
  '✗': 'danger',
  '!': 'caution',
}

/**
 * What `LiveScreen` and its progress line take.
 */
interface LiveScreenProps {
  /**
   * What to draw.
   */
  state: LiveViewState
  /**
   * Gives how long the run has taken so far, in ms, which the progress line shows.
   */
  elapsedMs: () => number
}

/**
 * Draws the spinner and the progress line, and redraws it every second, so the time taken moves on.
 */
function ProgressLine({ state, elapsedMs }: LiveScreenProps): ReactNode {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((previous) => previous + 1)
    }, tickMilliseconds)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return (
    <Text>
      <Spinner /> {progressLineOf(state, elapsedMs())}
    </Text>
  )
}

/**
 * Draws the live view: the printed lines, which never change again, each snapshot's mark in its colour, then, until
 * the view is finished, the progress line.
 */
export function LiveScreen({ state, elapsedMs }: LiveScreenProps): ReactNode {
  return (
    <>
      <Static items={state.printed}>
        {(line) => (
          <Text key={line.id}>
            {line.mark === undefined ? null : <ColouredText colour={markColours[line.mark]}>{line.mark}</ColouredText>}
            {line.text}
          </Text>
        )}
      </Static>
      {state.closed ? null : <ProgressLine elapsedMs={elapsedMs} state={state} />}
    </>
  )
}
