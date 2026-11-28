import type { Meta, StoryContext, StoryObj } from '@storybook/react-vite'
import { waitFor } from 'storybook/test'
import { visualCheck } from '../.storybook/visual-check.ts'
import { registerMockingWorker } from './mocking-worker.ts'
import { frameBodyOf, Note } from './network-parts.tsx'
import { remoteOrigin } from './remote-origin.ts'

declare global {
  /**
   * `true` when the end-to-end check's page errors cases run, through a script the check's server adds to every
   * `iframe.html` before Storybook imports any stories file. Each story here raises its page errors only then, apart
   * from those it expects itself, which it raises always, and `Stale`, which raises its expected error only when this
   * isn't set. `ExpectedByConfig`'s are expected only by the page errors config case's config. So every run but the
   * page errors cases lists none of these stories.
   */
  var __visualCheckE2ePageErrors: boolean | undefined
}

/**
 * The page the worker stories' iframe shows, inside the mocking worker's scope. It fetches the orders URL with the
 * status in its own `status` query parameter, which the worker answers with that status.
 */
const ordersFrame = '/sw-scope/orders.html'

/**
 * Whether the page errors cases run this page.
 */
function raisesPageErrors(): boolean {
  return globalThis.__visualCheckE2ePageErrors === true
}

/**
 * Gives a loader that runs `raise` when the page errors cases run this page, and does nothing otherwise. A loader
 * finishes before the story renders, so what it raises is on the page well before visual-check captures it.
 */
function raisingWhenAsked(raise: (context: StoryContext) => Promise<void> | void) {
  return async (context: StoryContext): Promise<Record<string, never>> => {
    if (raisesPageErrors()) {
      await raise(context)
    }

    return {}
  }
}

/**
 * Waits for the next turn of the event loop, by which time an error thrown in a timer, or a rejection nobody handles,
 * has reached the page.
 */
async function nextTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/**
 * Fetches a path of the story page's own origin and leaves out what came back, a network failure included.
 */
async function fetchPath(path: string): Promise<void> {
  await fetch(path).catch(() => undefined)
}

/**
 * What the worker stories' loader gives: the status the orders frame asks the worker for.
 */
interface OrdersLoaded {
  /**
   * The status of the worker's answer.
   */
  status: number
}

/**
 * A story that registers the mocking service worker, then shows the orders frame, which fetches the orders URL with
 * the status `statusOf` gives, as a story mocking its API with a mocking library does. `play` waits until the frame
 * has its answer and throws unless the answer has that status, so a server's 404 never passes for the worker's answer.
 */
function ordersStory(statusOf: () => number): Story {
  return {
    loaders: [
      async (): Promise<OrdersLoaded> => {
        await registerMockingWorker()

        return { status: statusOf() }
      },
    ],
    render: (_args, { loaded }) => (
      <iframe
        title="orders"
        src={`${ordersFrame}?status=${(loaded as OrdersLoaded).status}`}
        style={{ display: 'block', width: 360, height: 48, border: '2px solid #a1a1aa' }}
      />
    ),
    play: async ({ canvasElement, loaded }) => {
      const { status } = loaded as OrdersLoaded
      const answered = await waitFor(
        () => {
          const answer = frameBodyOf(canvasElement)?.dataset.status

          if (answer === undefined) {
            throw new Error("The orders frame hasn't fetched yet.")
          }

          return answer
        },
        { timeout: 5_000 },
      )

      if (answered !== String(status)) {
        throw new Error(`visual-check: the orders frame got ${answered}, expected the worker's ${status}`)
      }
    },
  }
}

/**
 * The page errors stories: see the README's section. Each raises its page errors in a loader, or in its orders frame,
 * and shows a note or the frame, the same whether it raised them or not, so its baseline holds in every run.
 */
const meta = {
  title: 'Page Errors',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Logs a `console.error`.
 */
export const ConsoleError: Story = {
  loaders: [raisingWhenAsked(() => console.error('visual-check e2e: a console.error'))],
  render: () => <Note text="console.error" />,
}

/**
 * Throws an error in a timer, which nothing catches.
 */
export const UncaughtError: Story = {
  loaders: [
    raisingWhenAsked(async () => {
      setTimeout(() => {
        throw new Error('visual-check e2e: an uncaught error')
      })
      await nextTurn()
    }),
  ],
  render: () => <Note text="uncaught error" />,
}

/**
 * Rejects a promise nobody handles.
 */
export const UnhandledRejection: Story = {
  loaders: [
    raisingWhenAsked(async () => {
      void Promise.reject(new Error('visual-check e2e: an unhandled rejection'))
      await nextTurn()
    }),
  ],
  render: () => <Note text="unhandled rejection" />,
}

/**
 * Fetches a file the server doesn't have, which it answers 404.
 */
export const MissingFile: Story = {
  loaders: [raisingWhenAsked(() => fetchPath('/visual-check-e2e/missing.json'))],
  render: () => <Note text="404" />,
}

/**
 * Fetches the path the end-to-end check's server answers with a 500.
 */
export const ServerError: Story = {
  loaders: [raisingWhenAsked(() => fetchPath('/visual-check-e2e/server-error'))],
  render: () => <Note text="500" />,
}

/**
 * Fetches the path whose connection the end-to-end check's server destroys, a network failure.
 */
export const DroppedLoad: Story = {
  loaders: [raisingWhenAsked(() => fetchPath('/visual-check-e2e/dropped'))],
  render: () => <Note text="network failure" />,
}

/**
 * The orders frame asks the mocking worker for a 500, which nothing expects, or for a 200 when the page errors cases
 * don't run.
 */
export const WorkerError: Story = ordersStory(() => (raisesPageErrors() ? 500 : 200))

/**
 * Logs a `console.warn`, which isn't a page error.
 */
export const ConsoleWarn: Story = {
  loaders: [raisingWhenAsked(() => console.warn('visual-check e2e: a console.warn'))],
  render: () => <Note text="console.warn" />,
}

/**
 * Loads an image the remote origin doesn't have, which it answers 404: a load from another origin isn't a page error.
 */
export const OtherOrigin: Story = {
  loaders: [
    raisingWhenAsked(async () => {
      const image = new Image()

      await new Promise((resolve) => {
        image.addEventListener('error', resolve)
        image.addEventListener('load', resolve)
        image.src = `${remoteOrigin}/visual-check-e2e/missing.png`
      })
    }),
  ],
  render: () => <Note text="other origin" />,
}

/**
 * The orders frame always asks the mocking worker for a 500, as an error-state story does, and the story expects it
 * with a regular expression that matches its URL.
 */
export const ExpectedWorkerError: Story = {
  ...ordersStory(() => 500),
  parameters: { ...visualCheck({ expectedPageErrors: [/\/visual-check-e2e\/orders\?visual-check-e2e-status=500$/] }) },
}

/**
 * Always logs a `console.error` and fetches a file the server doesn't have, and expects the first with a regular
 * expression that matches its message and the second with a string in its URL.
 */
export const ExpectedErrors: Story = {
  loaders: [
    async () => {
      console.error('visual-check e2e: an expected console.error')
      await fetchPath('/visual-check-e2e/expected-missing.json')

      return {}
    },
  ],
  render: () => <Note text="expected errors" />,
  parameters: {
    ...visualCheck({
      expectedPageErrors: [/an expected console\.error$/, '/visual-check-e2e/expected-missing.json'],
    }),
  },
}

/**
 * Logs a `console.error` and fetches a file the server doesn't have, which the page errors config case's config
 * expects, the first with a string and the second with a regular expression.
 */
export const ExpectedByConfig: Story = {
  loaders: [
    raisingWhenAsked(async () => {
      console.error('visual-check e2e: expected by the config')
      await fetchPath('/visual-check-e2e/expected-by-config.json')
    }),
  ],
  render: () => <Note text="expected by the config" />,
}

/**
 * Expects an error it logs only when the page errors cases don't run, so in theirs it's an error-state story whose
 * error went away, and its entry goes stale.
 */
export const Stale: Story = {
  loaders: [
    async () => {
      if (!raisesPageErrors()) {
        console.error('visual-check e2e: an error this story stopped raising')
      }

      return {}
    },
  ],
  render: () => <Note text="stale" />,
  parameters: { ...visualCheck({ expectedPageErrors: ['an error this story stopped raising'] }) },
}

/**
 * Logs a `console.error`, with `pageErrors: 'warn'`.
 */
export const Warn: Story = {
  loaders: [raisingWhenAsked(() => console.error('visual-check e2e: a console.error that warns'))],
  render: () => <Note text="warn" />,
  parameters: { ...visualCheck({ pageErrors: 'warn' }) },
}

/**
 * Logs a `console.error` and fetches a file the server doesn't have, with `pageErrors: 'off'`.
 */
export const Off: Story = {
  loaders: [
    raisingWhenAsked(async () => {
      console.error('visual-check e2e: a console.error nobody checks')
      await fetchPath('/visual-check-e2e/unchecked.json')
    }),
  ],
  render: () => <Note text="off" />,
  parameters: { ...visualCheck({ pageErrors: 'off' }) },
}

/**
 * Lists the `dark` mode and logs a `console.error` only when its `theme` global is `dark`, so only its `dark` snapshot
 * has a page error.
 */
export const TwoModes: Story = {
  loaders: [
    raisingWhenAsked(({ globals }) => {
      if (globals.theme === 'dark') {
        console.error('visual-check e2e: a console.error in the dark mode')
      }
    }),
  ],
  render: () => <Note text="two modes" />,
  parameters: { ...visualCheck({ modes: ['dark'] }) },
}
