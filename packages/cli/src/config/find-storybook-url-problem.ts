/**
 * What is wrong with a Storybook URL: it isn't an `http:` or `https:` URL, or it holds a user name or a password.
 *
 * @public
 */
export type StorybookUrlProblem = 'not-http' | 'login'

/**
 * Finds what makes a value unfit as a Storybook URL, or `undefined` when it is fit. visual-check sends no login to a
 * Storybook, so a URL that holds one is a problem, not a convenience. A login is found whatever the protocol, so a
 * message about the protocol is never the one that shows a password.
 *
 * @public
 */
export function findStorybookUrlProblem(value: unknown): StorybookUrlProblem | undefined {
  if (typeof value !== 'string' || !URL.canParse(value)) {
    return 'not-http'
  }

  const url = new URL(value)

  if (url.username !== '' || url.password !== '') {
    return 'login'
  }

  return ['http:', 'https:'].includes(url.protocol) ? undefined : 'not-http'
}

/**
 * Whether a text may hold a login, so a message leaves it out. A text with an `@` may: a malformed URL such as
 * `user:pass@host:6006` isn't parsed as one with a login, yet it holds one.
 *
 * @public
 */
export function mayHoldLogin(text: string): boolean {
  return text.includes('@')
}

/**
 * The fix the config's and `--url`'s login messages name, which reads after "visual-check sends no login:". A message
 * follows it with ` and point <the URL> at that.`
 *
 * @public
 */
export const serveStorybookFix =
  'serve Storybook where visual-check runs (storybook dev, or its static build served in the same CI job)'
