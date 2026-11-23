/**
 * The environment variable a static build carries the Storybook's name in, from its config. The manager reads it as
 * the literal `process.env.VISUAL_CHECK_STORYBOOK`, the one form Storybook's esbuild replaces.
 */
export const storybookNameKey = 'VISUAL_CHECK_STORYBOOK'

/**
 * The names of a loopback host, as `location.hostname` gives them.
 */
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * The characters of an address a shell reads as they are.
 */
const plainAddress = /^[A-Za-z0-9_./:@%+=,-]+$/

/**
 * The story and the build a static panel gives commands for.
 */
interface StaticCommandsInput {
  /**
   * The Storybook's name in visual-check's config.
   */
  storybook: string
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The address the build is served at, as `storybookAddressOf` gives it.
   */
  address: string
}

/**
 * The commands a static panel shows.
 */
interface StaticCommands {
  /**
   * The command that checks the story.
   */
  test: string
  /**
   * The command that rewrites the story's baselines.
   */
  update: string
}

/**
 * Tells whether a host name is `127.0.0.1`, `localhost` or `::1`, in any case.
 *
 * @public
 */
export function isLoopbackHost(hostname: string): boolean {
  return loopbackHosts.has(hostname.toLowerCase())
}

/**
 * Gives the address of the Storybook a page of it is at: its origin and folder, without the last `/`.
 *
 * @public
 */
export function storybookAddressOf(href: string): string {
  const { origin, pathname } = new URL('.', href)

  return `${origin}${pathname}`.replace(/\/$/, '')
}

/**
 * Quotes a text for a POSIX shell.
 */
function quoted(text: string): string {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Gives the `test` and `update` commands of one story of a static build. The filter matches the story's ID alone,
 * and the address is quoted when a shell would read it otherwise.
 *
 * @public
 */
export function staticCommandsOf({ storybook, storyId, address }: StaticCommandsInput): StaticCommands {
  const filter = quoted(`^${storyId.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}$`)
  const url = plainAddress.test(address) ? address : quoted(address)
  // Storybook names are lowercase letters, digits and `-`, so they need no quoting.
  const commandOf = (command: string) =>
    `visual-check ${command} --storybook ${storybook} --filter ${filter} --url ${url}`

  return { test: commandOf('test'), update: commandOf('update') }
}
