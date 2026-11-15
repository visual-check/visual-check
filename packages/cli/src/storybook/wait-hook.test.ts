import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { readWaitHookRun, waitHookExpression } from './wait-hook.js'

/**
 * Runs the wait hook expression in a page whose adapter's script gives this stand-in as `runWait`, and gives back what
 * the expression evaluates to, awaited.
 */
async function runExpression(expression: string, runWait: (...args: unknown[]) => unknown): Promise<unknown> {
  return await runInNewContext(expression, { __visualCheckStorybook: { runWait } })
}

describe('waitHookExpression', () => {
  it("asks the adapter's script in the page to run the story's wait hook, and gives its answer", async () => {
    const runWait = vi.fn(() => 'answer')

    expect(await runExpression(waitHookExpression('button--primary', 1000), runWait)).toBe('answer')
    expect(runWait.mock.calls).toEqual([['button--primary', 1000]])
  })

  it.each([
    [999.2, 1000],
    [1000, 1000],
    [-5, 0],
  ])('gives a time limit of %s ms as %s whole ms', async (timeoutMs, limit) => {
    const runWait = vi.fn()

    await runExpression(waitHookExpression('button--primary', timeoutMs), runWait)
    expect(runWait.mock.calls).toEqual([['button--primary', limit]])
  })

  it('embeds a story ID with quotes, a backslash and a line separator as it is', async () => {
    const storyId = 'quotes--a"b\'c\\d</script> '
    const runWait = vi.fn()

    await runExpression(waitHookExpression(storyId, 1000), runWait)
    expect(runWait.mock.calls).toEqual([[storyId, 1000]])
  })

  it("says when the adapter's script didn't run in the page", async () => {
    expect(JSON.parse(JSON.stringify(await runInNewContext(waitHookExpression('button--primary', 1000), {})))).toEqual({
      outcome: 'script-missing',
    })
  })
})

describe('readWaitHookRun', () => {
  it.each(['none', 'done', 'timed-out', 'no-render', 'script-missing'] as const)('reads the outcome %s', (outcome) => {
    expect(readWaitHookRun({ outcome })).toEqual({ outcome })
  })

  it('reads a wait hook that threw, saying what it threw', () => {
    expect(readWaitHookRun({ outcome: 'threw', text: 'Error: The data never came' })).toEqual({
      outcome: 'threw',
      message: "The story's wait hook threw Error: The data never came.",
    })
  })

  it("doesn't end a message with two periods", () => {
    expect(readWaitHookRun({ outcome: 'threw', text: 'Error: boom.' })).toHaveProperty(
      'message',
      "The story's wait hook threw Error: boom.",
    )
  })

  it('says the wait hook threw an error when what it threw has no text', () => {
    expect(readWaitHookRun({ outcome: 'threw', text: '' })).toHaveProperty(
      'message',
      "The story's wait hook threw an error.",
    )
  })

  it('reads a context the page failed to build, saying why', () => {
    expect(readWaitHookRun({ outcome: 'context-failed', text: 'Error: No context' })).toEqual({
      outcome: 'context-failed',
      message: "visual-check couldn't read the story's wait hook or build its context: Error: No context.",
    })
  })

  it("doesn't end a message about the context with two periods", () => {
    expect(readWaitHookRun({ outcome: 'context-failed', text: 'Error: No context.' })).toHaveProperty(
      'message',
      "visual-check couldn't read the story's wait hook or build its context: Error: No context.",
    )
  })

  it('says the context failed without the detail when the failure has no text', () => {
    expect(readWaitHookRun({ outcome: 'context-failed', text: '' })).toHaveProperty(
      'message',
      "visual-check couldn't read the story's wait hook or build its context.",
    )
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['another outcome', { outcome: 'finished' }],
    ['a throw without text', { outcome: 'threw' }],
    ['a throw with text other than a string', { outcome: 'threw', text: 42 }],
    ['a context failure without text', { outcome: 'context-failed' }],
    ['an outcome named like an object property', { outcome: 'toString', text: 'x' }],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readWaitHookRun(value)).toThrow(
      `The wait hook in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })
})
