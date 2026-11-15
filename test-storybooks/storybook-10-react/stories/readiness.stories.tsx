import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { userEvent, within } from 'storybook/test'
import lazySquare from './lazy-square.svg'

/**
 * What a note shows.
 */
interface NoteProps {
  /**
   * The note's text.
   */
  children: ReactNode
}

/**
 * A plain bordered note, the box each readiness story shows its result in.
 */
function Note({ children }: NoteProps) {
  return (
    <div
      style={{
        width: 400,
        padding: 16,
        border: '1px solid #a1a1aa',
        borderRadius: 6,
        background: '#f4f4f5',
        fontFamily: 'sans-serif',
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Resolves after this many milliseconds, on a timer.
 */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/**
 * Says it waits for `play` until its button is clicked, then says `play` finished.
 */
function PlayButton() {
  const [clicked, setClicked] = useState(false)

  return (
    <Note>
      <div>{clicked ? 'play finished' : 'Waiting for play'}</div>
      <button type="button" onClick={() => setClicked(true)}>
        Finish
      </button>
    </Note>
  )
}

/**
 * A note, then a 5000 px tall spacer, then a lazy image of a green square. Chromium loads lazy images early within
 * 1250 to 4000 px of the viewport, depending on the connection type, so the image sits 5000 px down, where the browser
 * leaves it unloaded.
 */
function LazyImageBelowFold() {
  return (
    <div>
      <div style={{ height: 5000 }}>
        <Note>A lazy image is below this spacer</Note>
      </div>
      <img loading="lazy" src={lazySquare} width={200} height={200} alt="" style={{ display: 'block' }} />
    </div>
  )
}

/**
 * The keyframes of the hidden element's infinite animation.
 */
const spinKeyframes =
  '@keyframes readiness-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'

/**
 * A hidden element of a few px with an infinite CSS animation, and a note the story's `afterEach` writes the element's
 * computed `animation-play-state` into.
 */
function HiddenAnimation() {
  return (
    <>
      <style>{spinKeyframes}</style>
      <div
        data-animated
        style={{ visibility: 'hidden', width: 4, height: 4, animation: 'readiness-spin 1s linear infinite' }}
      />
      <Note>
        <span data-play-state>animation-play-state not read yet</span>
      </Note>
    </>
  )
}

/**
 * Writes the hidden element's computed `animation-play-state` into the note, as `afterEach` sees it.
 */
function writePlayState(canvasElement: HTMLElement): void {
  const animated = canvasElement.querySelector('[data-animated]')
  const note = canvasElement.querySelector('[data-play-state]')

  if (animated === null || note === null) {
    return
  }

  note.textContent = `animation-play-state: ${getComputedStyle(animated).animationPlayState}`
}

/**
 * Throws the render error. It's a function of its own so the note after its call stays reachable, which the story's
 * baseline shows with the call taken out.
 */
function throwRenderError(): void {
  throw new Error('visual-check: the render threw')
}

/**
 * Throws as it renders, so its note never shows.
 */
function ThrowingNote() {
  throwRenderError()

  return <Note>the render throws</Note>
}

/**
 * Resolves once the window's `load` event has come, at once when it already has.
 */
async function waitForWindowLoad(): Promise<void> {
  if (document.readyState === 'complete') {
    return
  }

  await new Promise<void>((resolve) => {
    window.addEventListener('load', () => resolve(), { once: true })
  })
}

/**
 * The font face the font story asks for. Its file 404s under `storybook dev`, and the end-to-end check's server never
 * answers it.
 */
const neverLoadsFontFace = '@font-face { font-family: "Never Loads"; src: url("/visual-check-e2e/never-loads.woff2"); }'

/**
 * A note whose paragraph asks for the `Never Loads` font face, falling back to the generic sans-serif.
 */
function NeverLoadsFont() {
  return (
    <>
      <style>{neverLoadsFontFace}</style>
      <Note>
        <p style={{ margin: 0, fontFamily: '"Never Loads", sans-serif' }}>This text asks for a font that never loads</p>
      </Note>
    </>
  )
}

const meta = {
  title: 'Readiness',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * `play` waits 500 ms, then clicks the button, which changes the note. visual-check captures once `play` has finished,
 * so the snapshot shows `play finished`.
 */
export const PlayAwaits: Story = {
  render: () => <PlayButton />,
  play: async ({ canvasElement }) => {
    await sleep(500)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Finish' }))
  },
}

/**
 * A lazy image far below the fold, which the browser wouldn't load for a viewport at the top. visual-check makes lazy
 * images eager before it captures, so the full-page snapshot shows the square at the bottom.
 */
export const LazyImage: Story = {
  render: () => <LazyImageBelowFold />,
}

/**
 * A hidden element's infinite CSS animation, whose computed `animation-play-state` `afterEach` writes into the note.
 * On the test path, Storybook 9.1 and 10 add a stylesheet that pauses every animation before `afterEach`, which
 * visual-check empties, so the note says `running`, as in plain Storybook. Storybook 11 pauses through the Web
 * Animations API, which leaves the CSS value alone, so it says `running` there too.
 */
export const AnimationKeepsRunning: Story = {
  render: () => <HiddenAnimation />,
  afterEach: ({ canvasElement }) => {
    writePlayState(canvasElement)
  },
}

/**
 * The component throws as it renders. The story is broken, `error`, and its line says what it threw. Its committed
 * baseline, which `test` needs to capture it at all, is the story with the throw taken out.
 */
export const RenderThrows: Story = {
  render: () => <ThrowingNote />,
}

/**
 * `play` throws. Storybook reports the story finished, but sends `playFunctionThrewException` first, so the story
 * is broken, `play-threw`. Its committed baseline is the story without its `play`.
 */
export const PlayThrows: Story = {
  render: () => <Note>play throws</Note>,
  play: async () => {
    throw new Error('visual-check: play threw')
  },
}

/**
 * `play` schedules a timer that throws, then waits 100 ms, so the error is unhandled while `play` runs. Storybook sends
 * `unhandledErrorsWhilePlaying`, so the story is broken, `play-threw`. Its committed baseline is the story without its
 * `play`.
 */
export const PlayLeavesUnhandledError: Story = {
  render: () => <Note>play leaves an unhandled error</Note>,
  play: async () => {
    setTimeout(() => {
      throw new Error('visual-check: unhandled during play')
    }, 0)
    await sleep(100)
  },
}

/**
 * `play` waits on a promise that never settles, so Storybook never reports the story finished. The story is broken,
 * `timeout`, once `readyTimeout` runs out. Its committed baseline is the story without its `play`.
 */
export const NeverReady: Story = {
  render: () => <Note>play never finishes</Note>,
  play: async () => {
    await new Promise<never>(() => undefined)
  },
}

/**
 * Asks for a font face whose file never comes, so `document.fonts.ready` never resolves. The story is broken,
 * `fonts-not-loaded`, once `readyTimeout` runs out, naming the face. The loader waits for the window's `load` event
 * first, so the font's request can't hold up the `load` that visual-check's `goto` waits for. Under `storybook dev` the
 * file 404s and the story passes; its committed baseline is the story with the file 404ing, in the fallback font.
 */
export const FontNeverLoads: Story = {
  loaders: [waitForWindowLoad],
  render: () => <NeverLoadsFont />,
}
