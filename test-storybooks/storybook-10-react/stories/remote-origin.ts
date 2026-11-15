/**
 * The origin the stories load remote content from: `localhost` on the story page's own port. Served on `127.0.0.1`, as
 * the end-to-end check serves it, that's another origin than the page's, so it's remote; on `localhost` it's the same
 * origin, so nothing is remote.
 */
export const remoteOrigin = `${location.protocol}//localhost:${location.port}`

/**
 * The path of a 48 × 48 teal square, served from the Storybook's `static` folder.
 */
export const squarePath = '/remote-content/square.png'

/**
 * The teal square from the remote origin.
 */
export const remoteSquare = `${remoteOrigin}${squarePath}`
