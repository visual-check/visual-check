import { stateCallExpression, withDetail } from './preview-script.js'

/**
 * What running the story's wait hook in the page came to, in visual-check's own terms.
 *
 * @public
 */
export type WaitHookRun =
  | {
      /**
       * The story has no wait hook: none was set, or `wait: null` turned an inherited one off.
       */
      outcome: 'none'
    }
  | {
      /**
       * The wait hook ran and settled well.
       */
      outcome: 'done'
    }
  | {
      /**
       * The time limit passed before the wait hook settled.
       */
      outcome: 'timed-out'
    }
  | {
      /**
       * The wait hook threw or rejected.
       */
      outcome: 'threw'
      /**
       * One line for people saying what it threw.
       */
      message: string
    }
  | {
      /**
       * visual-check couldn't read the wait hook or build its context, so the hook never ran.
       */
      outcome: 'context-failed'
      /**
       * One line for people saying what went wrong.
       */
      message: string
    }
  | {
      /**
       * Storybook's preview had no render of the story, so there was no context to run the wait hook with.
       */
      outcome: 'no-render'
    }
  | {
      /**
       * The adapter's script hadn't run in the page, so there was nothing to run the wait hook with.
       */
      outcome: 'script-missing'
    }

/**
 * An outcome of the wait hook that carries a message.
 */
type MessageOutcome = Extract<WaitHookRun, { message: string }>['outcome']

/**
 * An outcome of the wait hook that carries nothing else.
 */
type PlainOutcome = Exclude<WaitHookRun, { message: string }>['outcome']

/**
 * Says what went wrong for each outcome that carries a message, from the page's description, which can be empty.
 */
const messages: Record<MessageOutcome, (text: string) => string> = {
  threw: (text) => withDetail("The story's wait hook threw", ' ', text, 'an error'),
  'context-failed': (text) =>
    withDetail("visual-check couldn't read the story's wait hook or build its context", ': ', text),
}

/**
 * Every outcome of the wait hook that carries nothing else.
 */
const plainOutcomes: readonly PlainOutcome[] = ['none', 'done', 'timed-out', 'no-render', 'script-missing']

/**
 * Builds the expression that runs this story's wait hook in the page and waits until it settles, or `timeoutMs`
 * passes, rounded up to whole ms. Its value is the page's answer, which `readWaitHookRun` reads.
 *
 * @public
 */
export function waitHookExpression(storyId: string, timeoutMs: number): string {
  return stateCallExpression('runWait', [storyId], timeoutMs)
}

/**
 * Whether a value is an outcome of the wait hook that carries a message.
 */
function isMessageOutcome(value: unknown): value is MessageOutcome {
  return typeof value === 'string' && Object.hasOwn(messages, value)
}

/**
 * Whether a value is an outcome of the wait hook that carries nothing else.
 */
function isPlainOutcome(value: unknown): value is PlainOutcome {
  return plainOutcomes.some((outcome) => outcome === value)
}

/**
 * Reads the value the wait hook expression gave, and says what it comes to. Throws, quoting the value, when it's not
 * an answer the page gives.
 *
 * @public
 */
export function readWaitHookRun(value: unknown): WaitHookRun {
  const answer: Record<string, unknown> = typeof value === 'object' && value !== null ? { ...value } : {}

  if (isMessageOutcome(answer.outcome) && typeof answer.text === 'string') {
    return { outcome: answer.outcome, message: messages[answer.outcome](answer.text) }
  }

  if (isPlainOutcome(answer.outcome)) {
    return { outcome: answer.outcome }
  }

  throw new Error(`The wait hook in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`)
}
