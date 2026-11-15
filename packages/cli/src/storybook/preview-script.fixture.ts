/**
 * Builds what the story wait in the page answers once Storybook reports the story finished: with `success`, no error
 * display, no error events and no time between render steps, unless `answer` says otherwise. `answer` can hold values
 * the page never gives, to test how they're read.
 *
 * @public
 */
export function finishedAnswer(answer: Record<string, unknown> = {}): Record<string, unknown> {
  return { outcome: 'finished', status: 'success', errorDisplay: false, errors: [], completingMs: null, ...answer }
}

/**
 * Builds what the story wait in the page answers when its time limit passed first: in `step`, with the story's last
 * render step, `null` when Storybook reported none.
 *
 * @public
 */
export function timedOutAnswer(step: string, lastRenderStep: string | null = null): Record<string, unknown> {
  return { outcome: 'timed-out', step, lastRenderStep }
}

/**
 * A fake of the page's `DocumentTimeline` class.
 */
class FakeDocumentTimeline {}

/**
 * A fake of a timeline other than the document's, such as a `ScrollTimeline`.
 *
 * @public
 */
export class FakeScrollTimeline {}

/**
 * What kind of animation a fake one is: a script's, from `element.animate()`, a CSS animation or a CSS transition.
 */
export type AnimationKind = 'script' | 'css-animation' | 'css-transition'

/**
 * How a fake animation starts. Each part has a default, given with it.
 */
export interface FakeAnimationOptions {
  /**
   * What kind of animation it is: a script's by default.
   */
  kind?: AnimationKind
  /**
   * The animation's play state: `running` by default.
   */
  playState?: string
  /**
   * The animation's current time, in ms: 0 by default.
   */
  currentTime?: number | null
  /**
   * The timeline the animation runs on: the document's by default.
   */
  timeline?: object | null
  /**
   * When the animation's effect ends, in ms: 1000 by default. `Number.POSITIVE_INFINITY` makes an infinite animation.
   */
  endTime?: number
  /**
   * Whether the animation's fill mode holds its end once it finished: no by default.
   */
  holdsEnd?: boolean
  /**
   * Whether the animation runs on a pseudo-element, so `commitStyles()` throws: no by default.
   */
  onPseudoElement?: boolean
}

/**
 * A fake animation, as a test sets it up and reads it back.
 *
 * @public
 */
export interface FakeAnimation {
  /**
   * The animation's play state.
   */
  playState: string
  /**
   * The animation's current time, in ms.
   */
  readonly currentTime: number | null
  /**
   * What was done to the animation, in order: `finish`, `pause`, `commitStyles`, `cancel`, and each assignment of its
   * current time, such as `currentTime = 0`.
   */
  readonly actions: string[]
  /**
   * Runs when the animation is finished, as page logic that reacts to its end does.
   */
  onFinish: (() => void) | undefined
  /**
   * Jumps to the end, then runs `onFinish`, through the `finish` of the page's `Animation` class, as the page does.
   */
  finish: () => void
  /**
   * Pauses where the animation is.
   */
  pause: () => void
}

/**
 * A fake of the page's `Animation` class, as a script's `element.animate()` makes, recording what's done to it.
 */
class ScriptAnimation implements FakeAnimation {
  /**
   * The animation's play state.
   */
  playState: string

  /**
   * The timeline the animation runs on.
   */
  readonly timeline: object | null

  /**
   * The animation's effect, which gives its computed timing: when it ends, and its progress, `null` once it finished
   * when its fill mode doesn't hold its end.
   */
  readonly effect: { getComputedTiming: () => { endTime: number; progress: number | null } }

  /**
   * What was done to the animation, in order.
   */
  readonly actions: string[] = []

  /**
   * Runs when the animation is finished.
   */
  onFinish: (() => void) | undefined

  /**
   * The animation's current time, in ms.
   */
  private time: number | null

  /**
   * When the animation's effect ends, in ms.
   */
  private readonly endTime: number

  /**
   * Whether `commitStyles()` throws.
   */
  private readonly onPseudoElement: boolean

  /**
   * Builds an animation that starts as `options` says.
   */
  constructor({
    playState = 'running',
    currentTime = 0,
    timeline = new FakeDocumentTimeline(),
    endTime = 1000,
    holdsEnd = false,
    onPseudoElement = false,
  }: FakeAnimationOptions) {
    this.playState = playState
    this.time = currentTime
    this.timeline = timeline
    this.endTime = endTime
    this.onPseudoElement = onPseudoElement
    this.effect = {
      getComputedTiming: () => ({ endTime, progress: this.playState === 'finished' && !holdsEnd ? null : 0 }),
    }
  }

  /**
   * The animation's current time, in ms.
   */
  get currentTime(): number | null {
    return this.time
  }

  /**
   * Seeks the animation, recording the assignment.
   */
  set currentTime(time: number | null) {
    this.actions.push(`currentTime = ${time}`)
    this.time = time
  }

  /**
   * Jumps to the end, then runs `onFinish`.
   */
  finish(): void {
    this.actions.push('finish')
    this.playState = 'finished'
    this.time = this.endTime
    this.onFinish?.()
  }

  /**
   * Pauses where the animation is.
   */
  pause(): void {
    this.actions.push('pause')
    this.playState = 'paused'
  }

  /**
   * Writes the animation's current value into the element's inline style. Throws on a pseudo-element.
   */
  commitStyles(): void {
    this.actions.push('commitStyles')

    if (this.onPseudoElement) {
      throw new Error('NoModificationAllowedError: the target is a pseudo-element.')
    }
  }

  /**
   * Removes the animation, so its root no longer lists it.
   */
  cancel(): void {
    this.actions.push('cancel')
    this.playState = 'idle'
    this.time = null
  }
}

/**
 * A fake of the page's `CSSAnimation` class.
 */
class CssAnimation extends ScriptAnimation {}

/**
 * A fake of the page's `CSSTransition` class.
 */
class CssTransition extends ScriptAnimation {}

/**
 * The fake class of each kind of animation.
 */
const animationClassOf: Record<AnimationKind, new (options: FakeAnimationOptions) => ScriptAnimation> = {
  script: ScriptAnimation,
  'css-animation': CssAnimation,
  'css-transition': CssTransition,
}

/**
 * The page's Web Animations classes, as fakes, to set as the page's globals: those the predicate for the animations
 * Storybook 11 parked reads, and the end state. Every fake animation finishes through `Animation.prototype.finish`,
 * which the end state wraps, so a test that creates the end state calls `restoreFinish` once it's done.
 *
 * @public
 */
export const animationClasses = {
  Animation: ScriptAnimation,
  CSSAnimation: CssAnimation,
  CSSTransition: CssTransition,
  DocumentTimeline: FakeDocumentTimeline,
}

/**
 * The fake `Animation` class's own `finish`, before any end state wrapped it.
 */
const ownFinish = ScriptAnimation.prototype.finish

/**
 * Puts the fake `Animation` class's own `finish` back. Every fake page shares the class, so the wrapper an end state
 * put on it would otherwise stay for the next test.
 *
 * @public
 */
export function restoreFinish(): void {
  ScriptAnimation.prototype.finish = ownFinish
}

/**
 * Builds a fake animation that starts as `options` says: a script's, running on the document's timeline at 0, ending
 * at 1000 ms with a fill mode that doesn't hold its end, unless `options` says otherwise.
 *
 * @public
 */
export function fakeAnimation(options: FakeAnimationOptions = {}): FakeAnimation {
  return new animationClassOf[options.kind ?? 'script'](options)
}
