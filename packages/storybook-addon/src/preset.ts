import { createRequire } from 'node:module'
import type { Channel } from 'storybook/internal/channels'
import type { Options, ServerApp } from 'storybook/internal/types'
import { type CheckRelay, startCheckRelay } from './check-relay/check-relay.js'
import { imageMiddleware } from './check-relay/image-route.js'
import { ownAddressOf } from './check-relay/own-address.js'
import { createEngineProcess } from './engine-process/engine-process.js'
import { storybookNameEnvOf } from './static-build/storybook-name-env.js'

/**
 * The relay of this Storybook, once its channel is there.
 */
let relay: CheckRelay | undefined

/**
 * Starts the relay on the channel of a Storybook in `storybook dev`. Nothing is forked before the first run.
 */
export function experimental_serverChannel(channel: Channel, options: Options): Channel {
  const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

  relay = startCheckRelay({
    channel,
    configDir: options.configDir,
    address: ownAddressOf(options),
    engine: createEngineProcess({ version }),
  })

  return channel
}

/**
 * Serves the images of the relay's results from the server of `storybook dev`.
 */
export function experimental_devServer(app: ServerApp): ServerApp {
  return app.use(imageMiddleware((id, path) => relay?.imageAt(id, path)))
}

/**
 * Adds the Storybook's name from visual-check's config to the manager's environment of a static build, whose panel
 * shows the commands for the current story.
 */
export function env(config: Record<string, string>, options: Options): Promise<Record<string, string>> {
  return storybookNameEnvOf(config, options)
}
