import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isImageUrl, readImageUrl } from '../channel-events/image-url.js'

/**
 * A request as Storybook's server passes it on.
 */
interface ServerRequest extends IncomingMessage {
  /**
   * The full URL, when a middleware in front cut a part off `url`.
   */
  originalUrl?: string
}

/**
 * A middleware of Storybook's server.
 */
type ImageMiddleware = (request: ServerRequest, response: ServerResponse, next: () => void) => Promise<void>

/**
 * The methods an image answers.
 */
const methods = ['GET', 'HEAD']

/**
 * The values of `Sec-Fetch-Site` an image answers: a page of this Storybook, or no page at all. A client that isn't a
 * browser, or a browser on an address that isn't secure, sends none.
 */
const sites: (string | undefined)[] = [undefined, 'same-origin', 'none']

/**
 * Reads an image, or gives `undefined` when its file is gone, as a later check may have removed it.
 */
async function readImage(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

/**
 * Gives the status that refuses the request, or `undefined` when it may have an image.
 */
function refusalOf({ method = 'GET', headers }: ServerRequest): number | undefined {
  if (!methods.includes(method)) {
    return 405
  }

  return sites.includes(headers['sec-fetch-site'] as string | undefined) ? undefined : 403
}

/**
 * Finds the image a request asks for, and reads it whole, so a file that goes meanwhile never breaks off an answer.
 */
async function imageOf(
  url: string,
  findImage: (id: string, path: string) => string | undefined,
): Promise<Buffer | undefined> {
  const asked = readImageUrl(url)
  const path = asked && findImage(asked.id, asked.path)

  return path === undefined ? undefined : await readImage(path)
}

/**
 * Makes the middleware that serves the results' images to this Storybook's own pages. The file comes from `findImage`
 * alone, so nothing of a request reaches the file system. Every other URL goes on to the next middleware.
 *
 * @public
 */
export function imageMiddleware(findImage: (id: string, path: string) => string | undefined): ImageMiddleware {
  return async (request, response, next) => {
    const url = request.originalUrl ?? request.url ?? ''

    if (!isImageUrl(url)) {
      next()

      return
    }

    // Storybook 10.0 lets every origin read every response.
    response.removeHeader('Access-Control-Allow-Origin')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')

    const refusal = refusalOf(request)

    if (refusal !== undefined) {
      response.writeHead(refusal, refusal === 405 ? { Allow: methods.join(', ') } : {}).end()

      return
    }

    const image = await imageOf(url, findImage)

    if (image === undefined) {
      response.writeHead(404).end()

      return
    }

    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length })
    response.end(request.method === 'HEAD' ? undefined : image)
  }
}
