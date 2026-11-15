import { vi } from 'vitest'
import { animationClasses, type FakeAnimation } from '../storybook/preview-script.fixture.js'
import { type FakeImageFile, type FakeMedia, fakeCreateElement } from './media.fixture.js'

/**
 * What a fake root holds.
 */
interface FakeRootParts {
  /**
   * The animations in the root.
   */
  animations?: FakeAnimation[]
  /**
   * The open shadow roots of elements in the root.
   */
  openShadowRoots?: FakeRoot[]
  /**
   * The videos, inline SVGs and images in the root.
   */
  media?: FakeMedia[]
}

/**
 * What a fake document holds.
 */
interface FakeDocumentParts extends FakeRootParts {
  /**
   * How the server gives each image file, by URL. A file not listed loads from the page's own origin, at 40 × 30.
   */
  files?: Record<string, FakeImageFile>
}

/**
 * A fake document or shadow root, as a test sets it up.
 */
export interface FakeRoot {
  /**
   * The animations in the root, cancelled ones included. A test can add some as the page would.
   */
  readonly animations: FakeAnimation[]
}

/**
 * A fake document, as a test sets it up.
 */
export interface FakeDocument extends FakeRoot {
  /**
   * The document's timeline.
   */
  readonly timeline: object
}

/**
 * Builds a fake shadow root holding these animations, open shadow roots and media. It lists its animations, leaving
 * out cancelled ones as the browser does. For `*`, it lists its elements: one hosting each open shadow root, one
 * hosting none, and its media. For a tag name, it lists its media of that name.
 */
export function fakeRoot({ animations = [], openShadowRoots = [], media = [] }: FakeRootParts = {}): FakeRoot {
  const elements = [...openShadowRoots.map((shadowRoot) => ({ shadowRoot })), { shadowRoot: null }, ...media]
  const root = {
    animations,
    getAnimations: () => animations.filter((animation) => animation.playState !== 'idle'),
    querySelectorAll: (selector: string) =>
      selector === '*' ? elements : media.filter((element) => element.localName === selector),
  }

  return root
}

/**
 * Builds a fake document holding these animations, open shadow roots and media, as `fakeRoot` does, with the
 * document's timeline, Storybook's preview URL as its base URL, and `createElement` for the images and canvases
 * scripts create. The images it creates load files as `files` says.
 */
export function fakeDocument({ files = {}, ...parts }: FakeDocumentParts = {}): FakeDocument {
  const document = {
    ...fakeRoot(parts),
    timeline: new animationClasses.DocumentTimeline(),
    baseURI: 'http://localhost:6006/iframe.html',
    createElement: fakeCreateElement(files),
  }

  return document
}

/**
 * The page's animation frames, on the test's clock: one every 16 ms while a callback waits for it. An animation frame
 * is one `requestAnimationFrame` callback, not the end state's frame of two callbacks and a task.
 */
export class FakeFrames {
  /**
   * The page's `requestAnimationFrame`: runs the callback at the next animation frame, 16 ms later.
   */
  readonly requestFrame = vi.fn((callback: () => void): void => {
    setTimeout(() => {
      this.count += 1
      this.reactions.get(this.count)?.()
      callback()
    }, 16)
  })

  /**
   * How many animation frames ran.
   */
  private count = 0

  /**
   * What page logic does at the start of an animation frame, by the animation frame's number.
   */
  private readonly reactions = new Map<number, () => void>()

  /**
   * Runs `reaction` at the start of the animation frame `animationFramesFromNow` animation frames from now, as page
   * logic that reacts then.
   */
  react(animationFramesFromNow: number, reaction: () => void): void {
    this.reactions.set(this.count + animationFramesFromNow, reaction)
  }
}

/**
 * Builds what the end state in the page answers once it's done, with whether it changed anything. `changed` can be a
 * value the page never gives, to test how it's read.
 */
export function settledAnswer(changed: unknown = false): Record<string, unknown> {
  return { outcome: 'settled', changed }
}

/**
 * Builds what the end state in the page answers when its time limit passed while it finished animations.
 */
export function animationsTimedOutAnswer(): Record<string, unknown> {
  return { outcome: 'timed-out', step: 'animations' }
}

/**
 * Builds what the end state in the page answers when its time limit passed while it put media on their first frame,
 * or in the last frames after media changed.
 */
export function mediaTimedOutAnswer(): Record<string, unknown> {
  return { outcome: 'timed-out', step: 'media' }
}
