import { vi } from 'vitest'
import { animationClasses, type FakeAnimation } from '../storybook/preview-script.fixture.js'
import type { FakeStyledElement } from './css-svg.fixture.js'
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
  /**
   * The elements with computed styles in the root.
   */
  styled?: FakeStyledElement[]
  /**
   * The `<iframe>` and `<frame>` elements in the root, as `fakeFrameElement` builds them.
   */
  frames?: object[]
}

/**
 * What a fake document holds.
 */
interface FakeDocumentParts extends FakeRootParts {
  /**
   * How the server gives each image file, by URL. A file not listed loads from the page's own origin, at 40 × 30.
   */
  files?: Record<string, FakeImageFile>
  /**
   * The document's window: none by default, as the top document's is the page's global scope.
   */
  view?: object
}

/**
 * A fake document or shadow root, as a test sets it up.
 */
export interface FakeRoot {
  /**
   * The animations in the root, cancelled ones included. A test can add some as the page would.
   */
  readonly animations: FakeAnimation[]
  /**
   * The sheets the root adopted.
   */
  adoptedStyleSheets: object[]
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
 * Builds a fake shadow root holding these animations, open shadow roots, media, elements with computed styles and
 * frames, adopting no sheet. It lists its animations, leaving out cancelled ones as the browser does. For `*`, it lists
 * its elements: one hosting each open shadow root, one hosting none, its media, its elements with computed styles and
 * its frames. For `iframe, frame`, it lists its frames, and for a tag name, its media of that name.
 */
export function fakeRoot({
  animations = [],
  openShadowRoots = [],
  media = [],
  styled = [],
  frames = [],
}: FakeRootParts = {}): FakeRoot {
  const elements = [
    ...openShadowRoots.map((shadowRoot) => ({ shadowRoot })),
    { shadowRoot: null },
    ...media,
    ...styled,
    ...frames,
  ]
  const elementsMatching = (selector: string): object[] => {
    if (selector === '*') {
      return elements
    }

    if (selector === 'iframe, frame') {
      return frames
    }

    return media.filter((element) => element.localName === selector)
  }
  const root = {
    animations,
    adoptedStyleSheets: [],
    getAnimations: () => animations.filter((animation) => animation.playState !== 'idle'),
    querySelectorAll: elementsMatching,
  }

  return root
}

/**
 * Builds a fake document holding these animations, open shadow roots, media and frames, as `fakeRoot` does, with its
 * window when `view` is given, the document's timeline, Storybook's preview URL as its base URL, and `createElement` for the images and canvases
 * scripts create. The images it creates load files as `files` says.
 */
export function fakeDocument({ files = {}, view, ...parts }: FakeDocumentParts = {}): FakeDocument {
  const document = {
    ...fakeRoot(parts),
    ...(view === undefined ? {} : { defaultView: view }),
    timeline: new animationClasses.DocumentTimeline(),
    baseURI: 'http://localhost:6006/iframe.html',
    createElement: fakeCreateElement(files),
  }

  return document
}

/**
 * Builds a fake `<iframe>` showing `document`, `null` for a cross-origin one, whose own page script recorded
 * `recordedShadowRoots` under the page script's global, when they're given.
 */
export function fakeFrameElement(document: object | null, recordedShadowRoots?: object[]): object {
  const contentWindow = recordedShadowRoots === undefined ? {} : { __visualCheck: { shadowRoots: recordedShadowRoots } }

  return { localName: 'iframe', shadowRoot: null, contentDocument: document, contentWindow }
}

/**
 * The page's animation frames, on the test's clock: one 16 ms after a callback asks for it. As in the browser, an
 * animation frame first runs the page logic that reacts then, as the end events the browser dispatches do, then every
 * callback asked for until then. A callback asked for during the callbacks waits for the next animation frame. An
 * animation frame is one step of the end state's frame of two callbacks and a task.
 */
export class FakeFrames {
  /**
   * The page's `requestAnimationFrame`: runs the callback at the next animation frame.
   */
  readonly requestFrame = vi.fn((callback: () => void): void => {
    this.callbacks.push(callback)

    if (!this.frameAhead) {
      this.frameAhead = true
      setTimeout(() => this.runFrame(), 16)
    }
  })

  /**
   * How many animation frames ran.
   */
  private count = 0

  /**
   * The callbacks waiting for the next animation frame.
   */
  private callbacks: (() => void)[] = []

  /**
   * Whether the next animation frame is on the clock.
   */
  private frameAhead = false

  /**
   * What page logic does at the start of an animation frame, in order, by the animation frame's number.
   */
  private readonly reactions = new Map<number, (() => void)[]>()

  /**
   * Runs `reaction` at the start of the animation frame `animationFramesFromNow` animation frames from now, after the
   * reactions already set for it and before its callbacks, as page logic that reacts then.
   */
  react(animationFramesFromNow: number, reaction: () => void): void {
    const frame = this.count + animationFramesFromNow

    this.reactions.set(frame, [...(this.reactions.get(frame) ?? []), reaction])
  }

  /**
   * Runs an animation frame: the page logic that reacts then, then the callbacks waiting for it, those the page logic
   * asked for included.
   */
  private runFrame(): void {
    this.count += 1

    for (const reaction of this.reactions.get(this.count) ?? []) {
      reaction()
    }

    const callbacks = this.callbacks

    this.callbacks = []
    this.frameAhead = false

    for (const callback of callbacks) {
      callback()
    }
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
