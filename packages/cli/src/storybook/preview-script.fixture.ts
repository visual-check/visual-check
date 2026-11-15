/**
 * Builds what the story wait in the page answers once Storybook reports the story finished: with `success`, no error
 * display, no error events and no time between render steps, unless `answer` says otherwise. `answer` can hold values
 * the page never gives, to test how they're read.
 *
 * @public
 */
export function finishedAnswer(answer: Record<string, unknown> = {}): Record<string, unknown> {
  return { outcome: 'finished', status: 'success', errorDisplay: false, errors: [], completingMs: null, ...answer }
}

/**
 * Builds what the story wait in the page answers when its time limit passed first: in `step`, with the story's last
 * render step, `null` when Storybook reported none.
 *
 * @public
 */
export function timedOutAnswer(step: string, lastRenderStep: string | null = null): Record<string, unknown> {
  return { outcome: 'timed-out', step, lastRenderStep }
}
