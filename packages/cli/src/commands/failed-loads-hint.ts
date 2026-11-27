import { docsUrlOf } from '../docs-site/docs-url.js'

/**
 * The docs page about running visual-check in CI, which says how to serve a static Storybook build.
 */
const ciDocsUrl = docsUrlOf('ci')

/**
 * Gives the hint for a broken story whose page couldn't load some of Storybook's own files, in one line, for the report
 * and `test`'s end block: the server dropped the connection, which a server that can't take many connections at once
 * does under parallel workers, what to serve the build with instead, and the CI docs page.
 */
export function failedLoadsHintMessageOf(): string {
  return (
    "Storybook's server dropped the connection or never answered. A server that can't take many connections at once, " +
    'such as python3 -m http.server, does this under parallel workers. Serve the static build with npx http-server ' +
    `instead, or run fewer --workers. See ${ciDocsUrl}`
  )
}
