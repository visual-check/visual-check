import { vi } from 'vitest'
import { animationClasses, type FakeAnimation } from '../storybook/preview-script.fixture.js'

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
 * Builds a fake shadow root holding these animations and open shadow roots. It lists its animations, leaving out
 * cancelled ones as the browser does, and, for `*`, its elements: one hosting each open shadow root, and one hosting
 * none.
 */
export function fakeRoot({ animations = [], openShadowRoots = [] }: FakeRootParts = {}): FakeRoot {
  const elements = [...openShadowRoots.map((shadowRoot) => ({ shadowRoot })), { shadowRoot: null }]
  const root = {
    animations,
    getAnimations: () => animations.filter((animation) => animation.playState !== 'idle'),
    querySelectorAll: (selector: string) => (selector === '*' ? elements : []),
  }

  return root
}

/**
 * Builds a fake document holding these animations and open shadow roots, as `fakeRoot` does, with the document's
 * timeline.
 */
export function fakeDocument(parts: FakeRootParts = {}): FakeDocument {
  return { ...fakeRoot(parts), timeline: new animationClasses.DocumentTimeline() }
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
