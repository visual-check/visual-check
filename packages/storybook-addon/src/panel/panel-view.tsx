import React, { type ReactNode, useState } from 'react'
import { type StorybookTheme, useTheme } from 'storybook/theming'
import type { StoryOutcome, StoryResult, VisualCheckState } from '../channel-events/events.js'
import type { ManagerState } from '../manager-state/manager-state.js'
import { ImageViewer } from './image-viewer.js'
import { panelCssOf } from './panel-css.js'
import { type PickedRow, rowOf, type SnapshotRow, selectedRowOf } from './snapshot-row.js'
import { Toolbar } from './toolbar.js'

/**
 * The story the panel is about.
 */
export interface PanelStory {
  /**
   * The story's ID.
   */
  id: string
  /**
   * The story's title and name, such as `Card / Default`.
   */
  name: string
}

/**
 * What `PanelView` takes.
 */
interface PanelViewProps {
  /**
   * The current story, or `null` when there is none, as on a docs page.
   */
  story: PanelStory | null
  /**
   * What every manager shows.
   */
  state: VisualCheckState
  /**
   * What the buttons do.
   */
  actions: Pick<ManagerState, 'check' | 'cancel'>
}

/**
 * What the parts that show a story's result take.
 */
interface ResultProps {
  /**
   * The story.
   */
  story: PanelStory
  /**
   * The story's latest result.
   */
  result: StoryResult
}

/**
 * What `StoryBody` takes.
 */
interface StoryBodyProps {
  /**
   * The current story, or `null` when there is none.
   */
  story: PanelStory | null
  /**
   * The story's latest result, or `undefined` when it has none.
   */
  result: StoryResult | undefined
  /**
   * Whether the story is checked now.
   */
  isRunning: boolean
}

/**
 * What `Rows` takes.
 */
interface RowsProps extends ResultProps {
  /**
   * The rows.
   */
  rows: SnapshotRow[]
}

/**
 * What `RowItem` takes.
 */
interface RowItemProps {
  /**
   * The row.
   */
  row: SnapshotRow
  /**
   * Whether the panel shows this row's images.
   */
  isSelected: boolean
  /**
   * Shows this row's images.
   */
  select: () => void
}

/**
 * Gives a story's result, or `undefined` when it has none.
 */
function resultOf({ results }: VisualCheckState, storyId: string): StoryResult | undefined {
  return Object.hasOwn(results, storyId) ? results[storyId] : undefined
}

/**
 * What there is to read about a row's snapshot. A plain pass has nothing.
 */
function RowNotes({ row: { status, flaky, message, reason, details, hints } }: Pick<RowItemProps, 'row'>): ReactNode {
  if (status === 'passed' && !flaky) {
    return null
  }

  return (
    <>
      <p data-visual-check="message">{message}</p>
      {reason !== null && (
        <p data-visual-check="reason">
          Reason: <code>{reason}</code>
        </p>
      )}
      {details.length > 0 && <pre data-visual-check="details">{details.join('\n')}</pre>}
      {[...new Set(hints)].map((hint) => (
        <p key={hint} data-visual-check="hint">
          Hint: {hint}
        </p>
      ))}
    </>
  )
}

/**
 * A row of the list: its button, and below it what there is to read.
 */
function RowItem({ row, isSelected, select }: RowItemProps): ReactNode {
  return (
    <li>
      <button type="button" data-visual-check="row" data-status={row.status} aria-pressed={isSelected} onClick={select}>
        <span data-visual-check="label">{row.label}</span> {row.flaky && <span data-visual-check="flaky">Flaky</span>}{' '}
        <span data-visual-check="status">{row.statusText}</span>
      </button>
      <RowNotes row={row} />
    </li>
  )
}

/**
 * The rows of a check that finished, and the images of the selected one.
 */
function Rows({ story, result, rows }: RowsProps): ReactNode {
  const [picked, setPicked] = useState<PickedRow>()
  const selected = selectedRowOf(rows, result.id, picked)

  return (
    <div data-visual-check="snapshots">
      <ul data-visual-check="rows">
        {rows.map((row) => (
          <RowItem
            key={row.key}
            row={row}
            isSelected={row === selected}
            select={() => setPicked({ key: row.key, resultId: result.id })}
          />
        ))}
      </ul>
      {selected && <ImageViewer key={selected.key} storyName={story.name} resultId={result.id} row={selected} />}
    </div>
  )
}

/**
 * What a check that a problem stopped says.
 */
function Stopped({ cause, message }: StoryOutcome & { result: 'stopped' }): ReactNode {
  return (
    <>
      <p role="alert" data-visual-check="error">
        {message}
      </p>
      {cause === 'config' && (
        <p data-visual-check="init-hint">
          Run <code>visual-check init</code> to set this Storybook up.
        </p>
      )}
    </>
  )
}

/**
 * How the story's run ended.
 */
function Outcome(props: ResultProps): ReactNode {
  const { outcome } = props.result

  if (outcome.result === 'stopped') {
    // The key makes a new alert of a problem that comes again, so it's announced again.
    return <Stopped key={props.result.id} {...outcome} />
  }

  if (outcome.disabled) {
    return (
      <p data-visual-check="disabled">
        parameters.visualCheck disables this story, so visual-check doesn't capture it.
      </p>
    )
  }

  // An update's rows come with the Update button, which asks for one.
  return outcome.result === 'checked' && <Rows {...props} rows={outcome.snapshots.map(rowOf)} />
}

/**
 * A story's latest result, dimmed while it's stale or the story is checked again.
 */
function Result({ story, result, isRunning }: ResultProps & { isRunning: boolean }): ReactNode {
  const { stale, outcome } = result

  return (
    <>
      {stale && <p data-visual-check="stale">Stale: something changed since this check. Check again.</p>}
      <div data-visual-check="results" data-dimmed={stale || isRunning || undefined}>
        {[...new Set(outcome.notices)].map((notice) => (
          <p key={notice} data-visual-check="notice">
            {notice}
          </p>
        ))}
        <Outcome story={story} result={result} />
      </div>
    </>
  )
}

/**
 * What the panel shows below its toolbar.
 */
function StoryBody({ story, result, isRunning }: StoryBodyProps): ReactNode {
  if (story === null) {
    return <p data-visual-check="empty">Select a story to check it.</p>
  }

  if (result !== undefined) {
    // The key forgets the picked row when another story is selected.
    return <Result key={story.id} story={story} result={result} isRunning={isRunning} />
  }

  return isRunning ? null : <p data-visual-check="empty">This story isn't checked yet.</p>
}

/**
 * The panel: the buttons, the run and the current story's latest result.
 */
export function PanelView({ story, state, actions }: PanelViewProps): ReactNode {
  const storyId = story?.id ?? null
  const result = storyId === null ? undefined : resultOf(state, storyId)
  const isRunning = storyId !== null && state.run?.storyId === storyId

  return (
    <div data-visual-check="panel">
      <style>{panelCssOf(useTheme() as StorybookTheme)}</style>
      <Toolbar storyId={storyId} run={state.run} result={result} actions={actions} />
      <StoryBody story={story} result={result} isRunning={isRunning} />
    </div>
  )
}
