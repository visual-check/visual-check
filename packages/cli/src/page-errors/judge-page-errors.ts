import type { PageError } from '../capture/driver/driver.js'
import type { PageErrorPolicy } from './page-error-policy.js'

/**
 * A page error that isn't expected, with what it does to the run.
 *
 * @public
 */
export interface JudgedPageError extends PageError {
  /**
   * `'fail'` fails `test`, by the snapshot's `pageErrors: 'fail'`; `'warn'` is only listed, by `pageErrors: 'warn'`.
   */
  severity: 'fail' | 'warn'
}

/**
 * What a snapshot's page errors come to by its policy: the ones that aren't expected, and the story's own expected page
 * errors that matched none of them.
 *
 * @public
 */
export interface JudgedPageErrors {
  /**
   * The page errors no expected page error matches, in the order gathered, each with its severity.
   */
  pageErrors: JudgedPageError[]
  /**
   * The story's own expected page errors that matched none of the snapshot's page errors, as written: a string as JSON,
   * such as `"Failed to fetch"`, and a regular expression as its literal, such as `/timeout/i`.
   */
  staleExpectedPageErrors: string[]
}

/**
 * What judging needs to know of the snapshot besides its page errors.
 */
interface JudgedSnapshot {
  /**
   * Whether the snapshot is broken, which keeps the story's expected page errors from going stale.
   */
  broken: boolean
}

/**
 * Whether an expected page error matches a page error's text: a string that the text contains, or a regular expression
 * the text's `search` finds. `search` resets the expression's `lastIndex` to 0 and restores it after, so the answer is
 * the same every time: a `g` flag has no effect, and a `y` flag matches only at the start of the text.
 */
function matches(entry: string | RegExp, text: string): boolean {
  return typeof entry === 'string' ? text.includes(entry) : text.search(entry) !== -1
}

/**
 * Gives an expected page error as written: a string as JSON, a regular expression as its literal.
 */
function displayOf(entry: string | RegExp): string {
  return typeof entry === 'string' ? JSON.stringify(entry) : String(entry)
}

/**
 * Judges a snapshot's gathered page errors by its policy. With `check: 'off'` there's nothing to list. Otherwise each
 * page error an expected page error matches is dropped, and the rest are listed with the policy's severity. The story's
 * own expected page errors that matched none are stale, unless the snapshot is `broken`: a broken story may not have
 * got as far as raising them.
 *
 * @public
 */
export function judgePageErrors(
  errors: readonly PageError[],
  policy: PageErrorPolicy,
  { broken }: JudgedSnapshot,
): JudgedPageErrors {
  const { check, expected, storyExpected } = policy

  if (check === 'off') {
    return { pageErrors: [], staleExpectedPageErrors: [] }
  }

  return {
    pageErrors: errors
      .filter((error) => !expected.some((entry) => matches(entry, error.text)))
      .map((error) => ({ ...error, severity: check })),
    staleExpectedPageErrors: broken
      ? []
      : storyExpected
          .filter((entry) => !errors.some((error) => matches(entry, error.text)))
          .map((entry) => displayOf(entry)),
  }
}
