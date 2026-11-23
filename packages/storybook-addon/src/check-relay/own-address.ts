import { isIPv6 } from 'node:net'

/**
 * The hosts that mean every address of the machine.
 */
const wildcards = ['0.0.0.0', '::']

/**
 * Gives the host Storybook is reached at. Without a name of its own, it's the loopback one, which certificates name
 * `localhost`.
 */
function hostOf(host: string | undefined, https: boolean): string {
  if (host === undefined || host === '' || wildcards.includes(host)) {
    return https ? 'localhost' : '127.0.0.1'
  }

  return isIPv6(host) ? `[${host}]` : host
}

/**
 * Gives Storybook's own address from the options it runs with.
 *
 * @public
 */
export function ownAddressOf(options: {
  /**
   * The port it listens on.
   */
  port?: number
  /**
   * The host given with `--host`.
   */
  host?: string
  /**
   * Whether it's served over HTTPS.
   */
  https?: boolean
}): string {
  const { port, host, https = false } = options
  const address = `${https ? 'https' : 'http'}://${hostOf(host, https)}`

  return port === undefined ? address : `${address}:${port}`
}
