/**
 * A regular expression the page read from a story's options that Node.js can't build, such as one with a syntax the
 * browser knows and Node.js doesn't yet. It keeps the source and flags, so validation can name it and reject it at its
 * key path, rather than the whole read failing.
 *
 * @public
 */
export class UnrunnableRegExp {
  /**
   * The source, as the page read it.
   */
  readonly source: string
  /**
   * The flags, as the page read them.
   */
  readonly flags: string

  /**
   * Keeps the source and flags of a regular expression Node.js couldn't build.
   */
  constructor(source: string, flags: string) {
    this.source = source
    this.flags = flags
  }
}
