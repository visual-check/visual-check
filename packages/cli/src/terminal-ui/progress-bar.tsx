import { Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'

/**
 * How many cells of a progress bar are filled and how many are empty.
 */
interface ProgressCells {
  /**
   * The cells for the work done.
   */
  filled: number
  /**
   * The cells for the work left.
   */
  empty: number
}

/**
 * What `ProgressBar` takes.
 */
interface ProgressBarProps {
  /**
   * How many of the steps are done.
   */
  done: number
  /**
   * How many steps there are.
   */
  total: number
  /**
   * What follows the bar in place of the count, such as `Step 3 of 9`.
   */
  label?: string
  /**
   * How many cells wide the bar is.
   */
  width?: number
}

/**
 * Splits a bar `width` cells wide into filled and empty cells for `done` of `total` steps, rounded to the nearest cell.
 * `done` is clamped between none and `total`, and a bar with no steps is empty.
 */
export function progressCellsOf(done: number, total: number, width: number): ProgressCells {
  if (total <= 0) {
    return { filled: 0, empty: width }
  }

  const filled = Math.round((Math.min(Math.max(done, 0), total) / total) * width)

  return { filled, empty: width - filled }
}

/**
 * A bar of how many steps are done, in the accent colour, with the count after it, `━━━───── 3/8`, or the label in
 * its place.
 */
export function ProgressBar({ done, total, label = `${done}/${total}`, width = 20 }: ProgressBarProps): ReactNode {
  const cells = progressCellsOf(done, total, width)

  return (
    <Text>
      <ColouredText colour="accent">{'━'.repeat(cells.filled)}</ColouredText>
      <Text dimColor>{'─'.repeat(cells.empty)}</Text>
      {` ${label}`}
    </Text>
  )
}
