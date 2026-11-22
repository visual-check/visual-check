import React, { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'
import type { StoryResult, StoryRun } from '../channel-events/events.js'
import type { ManagerState } from '../manager-state/manager-state.js'
import { isCancelled, logTextOf, type StatusSubject, statusLineOf } from './panel-text.js'

/**
 * What the toolbar takes.
 */
interface ToolbarProps {
  /**
   * The current story's ID, or `null` when there is none.
   */
  storyId: string | null
  /**
   * The run in flight, or `null`.
   */
  run: StoryRun | null
  /**
   * The current story's latest result, or `undefined` when it has none.
   */
  result: StoryResult | undefined
  /**
   * What the buttons do.
   */
  actions: Pick<ManagerState, 'check' | 'cancel'>
}

/**
 * What `CancelButton` takes.
 */
interface CancelButtonProps {
  /**
   * The run in flight.
   */
  run: StoryRun
  /**
   * The Check button, which gets the focus when this one goes.
   */
  checkButton: RefObject<HTMLButtonElement | null>
  /**
   * What the button does.
   */
  actions: Pick<ManagerState, 'cancel'>
}

/**
 * Asks for a check of the story, unless there is none or a run is in flight.
 */
export function checkFromPanel({ storyId, run, actions }: Pick<ToolbarProps, 'storyId' | 'run' | 'actions'>): void {
  if (storyId !== null && run === null) {
    actions.check(storyId)
  }
}

/**
 * Cancels the run, unless it's being cancelled.
 */
export function cancelFromPanel({ run, actions }: Pick<CancelButtonProps, 'run' | 'actions'>): void {
  if (!run.cancelling) {
    actions.cancel()
  }
}

/**
 * The button that cancels the run. It hands the focus on to the Check button when it goes with the run's end.
 */
function CancelButton({ run, checkButton, actions }: CancelButtonProps): ReactNode {
  const ownButton = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const button = ownButton.current

    return () => {
      if (button !== null && button === button.ownerDocument.activeElement) {
        checkButton.current?.focus()
      }
    }
  }, [checkButton])

  return (
    <button
      ref={ownButton}
      type="button"
      data-visual-check="cancel"
      aria-disabled={run.cancelling}
      onClick={() => cancelFromPanel({ run, actions })}
    >
      Cancel
    </button>
  )
}

/**
 * The buttons, how far the run is or what the last one came to, and the log of the browser's pull or download. A button
 * that can't be used stays focusable, so a click on it doesn't lose the focus.
 */
export function Toolbar({ storyId, run, result, actions }: ToolbarProps): ReactNode {
  const checkButton = useRef<HTMLButtonElement>(null)
  const [last, setLast] = useState<StatusSubject>({ run, storyId, result, cancelled: false })

  if (last.run !== run || last.storyId !== storyId || last.result !== result) {
    setLast({ run, storyId, result, cancelled: isCancelled(last, { run, storyId, result }) })
  }

  return (
    <>
      <div data-visual-check="toolbar">
        <button
          ref={checkButton}
          type="button"
          data-visual-check="check"
          aria-disabled={storyId === null || run !== null}
          onClick={() => checkFromPanel({ storyId, run, actions })}
        >
          Check
        </button>
        {run !== null && <CancelButton run={run} checkButton={checkButton} actions={actions} />}
        <p role="status" data-visual-check="run">
          {last.cancelled ? 'Cancelled' : statusLineOf(run, storyId, result)}
        </p>
      </div>
      {run?.step === 'browser' && <pre data-visual-check="log">{logTextOf(run.log)}</pre>}
    </>
  )
}
