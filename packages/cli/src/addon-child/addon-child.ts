import { checkStory } from '../commands/check-story.js'
import { createLaunchBrowser, type LaunchBrowser } from '../commands/launch-browser.js'
import type { StoryRunOptions } from '../commands/story-run.js'
import { updateStory } from '../commands/update-story.js'
import { createWarmBrowser } from '../commands/warm-browser.js'
import { createImageFiles } from './image-files.js'
import type { AddonMessage, AddonOutcome, StoryRequest } from './protocol.js'
import { readAddonRequest } from './read-request.js'

/**
 * What the child process runs with.
 *
 * @public
 */
export interface AddonChildOptions {
  /**
   * The CLI's version.
   */
  version: string
  /**
   * The absolute folder Storybook runs in. Paths in messages are relative to it.
   */
  cwd: string
  /**
   * The environment the checks and the updates read.
   */
  environment: Record<string, string | undefined>
  /**
   * Sends a message to the process that forked the child.
   */
  send: (message: AddonMessage) => void
  /**
   * Launches the browser. By default each launch goes where it says, with a launcher of its own. A test gives a fake.
   */
  launchBrowser?: LaunchBrowser
  /**
   * Checks one story. `checkStory` by default. A test gives a fake.
   */
  check?: typeof checkStory
  /**
   * Updates one story's baselines. `updateStory` by default. A test gives a fake.
   */
  update?: typeof updateStory
}

/**
 * What the child process does with its messages until it exits.
 *
 * @public
 */
export interface AddonChild {
  /**
   * Takes a message. One that is no request is ignored.
   */
  receive: (message: unknown) => void
  /**
   * Aborts the running check or update, waits for it to end and closes the browser. Every check or update asked for
   * afterwards ends cancelled. Calling it again gives the same promise.
   */
  close: () => Promise<void>
}

/**
 * The check or the update that runs.
 */
interface RunningStory {
  /**
   * The request's ID.
   */
  id: string
  /**
   * Cancels it.
   */
  controller: AbortController
  /**
   * Settles once its end has been sent.
   */
  ended: Promise<void>
}

/**
 * Makes what the child process of the Storybook addon runs, and sends `ready` at once. It runs one check or update at a
 * time, and keeps one browser between runs, and the images' files of checks.
 *
 * @public
 */
export function createAddonChild({
  send,
  version,
  cwd,
  environment,
  // A launcher remembers the executable it installed, so each launch over the child's life has its own.
  launchBrowser = (launch) => createLaunchBrowser()(launch),
  check = checkStory,
  update = updateStory,
}: AddonChildOptions): AddonChild {
  const warmBrowser = createWarmBrowser(launchBrowser)
  const images = createImageFiles()
  let running: RunningStory | undefined
  let closing: Promise<void> | undefined

  const finish = (id: string, outcome: AddonOutcome): void => {
    send({ kind: 'finished', id, outcome })
  }

  const run = async ({ kind, id, storyId, configDir, url }: StoryRequest, signal: AbortSignal): Promise<void> => {
    const story: StoryRunOptions = {
      storyId,
      configDir,
      url,
      cwd,
      environment,
      launchBrowser: warmBrowser.launcherFor(signal),
      signal,
      progress: (progress) => send({ kind: 'progress', id, progress }),
    }
    let outcome: AddonOutcome

    try {
      outcome = kind === 'check' ? await check({ ...story, images }) : await update(story)
    } finally {
      running = undefined
    }

    finish(id, outcome)
  }

  const start = (request: StoryRequest): void => {
    if (closing !== undefined) {
      finish(request.id, { result: 'cancelled' })

      return
    }

    if (running !== undefined) {
      const message = 'visual-check is already running a check or an update.'

      finish(request.id, { result: 'stopped', cause: 'run', message, notices: [] })

      return
    }

    const controller = new AbortController()

    running = { id: request.id, controller, ended: run(request, controller.signal) }
  }

  const cancel = (id: string): void => {
    if (running?.id === id) {
      running.controller.abort()
    }
  }

  const closeAll = async (): Promise<void> => {
    running?.controller.abort()
    await Promise.all([running?.ended, warmBrowser.close()])
  }

  send({ kind: 'ready', protocol: 1, version })

  return {
    receive: (message) => {
      const request = readAddonRequest(message)

      switch (request?.kind) {
        case 'check':
        case 'update':
          start(request)
          break
        case 'cancel':
          cancel(request.id)
          break
      }
    },
    close: () => {
      closing ??= closeAll()

      return closing
    },
  }
}
