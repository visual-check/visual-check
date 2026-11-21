import { createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  animationClasses,
  type FakeAnimation,
  FakeScrollTimeline,
  fakeAnimation,
  restoreFinish,
} from '../storybook/preview-script.fixture.js'
import { parkedByStorybookSource } from '../storybook/preview-script.js'
import {
  animationsTimedOutAnswer,
  FakeFrames,
  fakeDocument,
  fakeFrameElement,
  fakeRoot,
  mediaTimedOutAnswer,
  settledAnswer,
} from './end-state.fixture.js'
import { endStateFunction, readEndState } from './end-state.js'
import { type FakeMedia, fakeImage, fakeSvg, fakeVideo, firstFrameUrl } from './media.fixture.js'

/**
 * What a fake page for the end state has.
 */
interface EndStatePageParts {
  /**
   * The page's document: one holding `animations` and `media` by default.
   */
  document?: object
  /**
   * The animations in the page's document, when `document` isn't given: none by default.
   */
  animations?: FakeAnimation[]
  /**
   * The videos, inline SVGs and images in the page's document, when `document` isn't given: none by default.
   */
  media?: FakeMedia[]
  /**
   * The shadow roots the page script recorded: none by default.
   */
  shadowRoots?: object[]
  /**
   * The page's globals besides `document` and `URL`: the fake Web Animations classes by default.
   */
  globals?: Record<string, unknown>
  /**
   * The page's `requestAnimationFrame` as the page script kept it, `undefined` for a page without one: the fake frames'
   * by default.
   */
  requestFrame?: ((callback: () => void) => void) | undefined
}

/**
 * The end state started in a fake page.
 */
interface EndStateRun {
  /**
   * The page's answer, as the driver gives it: passed through JSON.
   */
  answer: Promise<unknown>
  /**
   * Whether the page has answered.
   */
  settled: () => boolean
}

/**
 * A fake page with the end state created in it, as the page script creates it.
 */
interface EndStatePage {
  /**
   * The page's animation frames.
   */
  frames: FakeFrames
  /**
   * The browser's own `setTimeout`, as the page script kept it.
   */
  setTimer: Mock<(callback: () => void, ms: number) => unknown>
  /**
   * The browser's own `clearTimeout`, as the page script kept it.
   */
  clearTimer: Mock<(timer: unknown) => void>
  /**
   * Runs JavaScript in the page.
   */
  run: (code: string) => unknown
  /**
   * Starts bringing the page to its end state, with this time limit.
   */
  bringToEndState: (timeoutMs: number) => EndStateRun
}

/**
 * Builds a fake page with these parts and creates the end state in it, with the real predicate for Storybook 11's
 * parked animations.
 */
function openEndState(parts: EndStatePageParts = {}): EndStatePage {
  const { animations = [], media = [], shadowRoots = [], globals = animationClasses } = parts
  const document = parts.document ?? fakeDocument({ animations, media })
  const frames = new FakeFrames()
  const requestFrame = 'requestFrame' in parts ? parts.requestFrame : frames.requestFrame
  const context = createContext({ URL, ...globals, document })
  const run = (code: string): unknown => runInContext(code, context)
  const setTimer = vi.fn((callback: () => void, ms: number): unknown => setTimeout(callback, ms))
  const clearTimer = vi.fn((timer: unknown): void => {
    clearTimeout(timer as Parameters<typeof clearTimeout>[0])
  })
  const create = run(endStateFunction) as (context: object) => (timeoutMs: number) => Promise<unknown>
  const bring = create({
    shadowRoots,
    setTimer,
    clearTimer,
    requestFrame,
    parkedByStorybook: run(parkedByStorybookSource),
    stateGlobal: '__visualCheck',
  })

  return {
    frames,
    setTimer,
    clearTimer,
    run,
    bringToEndState: (timeoutMs) => {
      let settled = false
      const answer = bring(timeoutMs)
        .then((value) => JSON.parse(JSON.stringify(value)))
        .finally(() => {
          settled = true
        })

      return { answer, settled: () => settled }
    },
  }
}

/**
 * Brings a fake page with these parts to its end state, with a time limit of 10 s, running the page's frames and
 * timers until it answers. Gives its answer.
 */
async function endStateOf(parts: EndStatePageParts): Promise<unknown> {
  const run = openEndState(parts).bringToEndState(10_000)

  await vi.runAllTimersAsync()

  return await run.answer
}

/**
 * Has page logic listen for the end of `animation`, as an `animationend` listener does. The browser dispatches the end
 * events of an animation finished by a call at the next animation frame, before its callbacks. When the animation was
 * cancelled meanwhile, it dispatches `animationcancel` instead, so the listener doesn't run.
 */
function listenForEnd(frames: FakeFrames, animation: FakeAnimation, listener: () => void): void {
  animation.onFinish = () => {
    frames.react(1, () => {
      if (animation.playState !== 'idle') {
        listener()
      }
    })
  }
}

/**
 * Has page logic listen for `type` events on a media element, reacting at the next animation frame, as a state update
 * that a listener makes is committed then.
 */
function reactToMediaEvent(frames: FakeFrames, element: FakeMedia, type: string, reaction: () => void): void {
  element.addEventListener(type, () => frames.react(1, reaction))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  restoreFinish()
})

describe('settling', () => {
  it('changes nothing and waits no frame when nothing is running', async () => {
    const page = openEndState()

    expect(await page.bringToEndState(1000).answer).toEqual(settledAnswer(false))
    expect(page.frames.requestFrame).not.toHaveBeenCalled()
    expect(page.setTimer).toHaveBeenCalledOnce()
    expect(page.setTimer).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(page.clearTimer).toHaveBeenCalledWith(page.setTimer.mock.results[0]?.value)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('finishes a running finite animation, checks twice a frame apart, then lets two more frames pass', async () => {
    const animation = fakeAnimation()
    const page = openEndState({ animations: [animation] })
    const run = page.bringToEndState(1000)

    // Each frame is two animation frames of 16 ms, then a task.
    await vi.advanceTimersByTimeAsync(127)
    expect(run.settled()).toBe(false)
    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(animation.actions).toEqual(['finish'])
    // Four frames of two callbacks, and the two callbacks after which its finish() call's end events no longer count
    // as pending. Those run in the first frame's animation frames, so the second check finds nothing pending.
    expect(page.frames.requestFrame).toHaveBeenCalledTimes(10)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('finishes an animation that the end of another starts at the next frame', async () => {
    const first = fakeAnimation()
    const second = fakeAnimation()
    const document = fakeDocument({ animations: [first] })
    const page = openEndState({ document })

    first.onFinish = () => page.frames.react(1, () => document.animations.push(second))

    const run = page.bringToEndState(10_000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(second.actions).toEqual(['finish'])
  })

  it('finishes an animation that page logic starts after one quiet check', async () => {
    const first = fakeAnimation()
    const late = fakeAnimation()
    const document = fakeDocument({ animations: [first] })
    const page = openEndState({ document })

    // The end state's frame after finishing spans animation frames 1 and 2, so its frame after the quiet check starts
    // at 3.
    first.onFinish = () => page.frames.react(3, () => document.animations.push(late))

    const run = page.bringToEndState(10_000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(late.actions).toEqual(['finish'])
  })

  it('stops after 20 rounds, and puts an animation still starting on its first keyframe and pins it', async () => {
    const restarting = fakeAnimation()

    restarting.onFinish = () => {
      restarting.playState = 'running'
    }

    expect(await endStateOf({ animations: [restarting] })).toEqual(settledAnswer(true))
    expect(restarting.actions.filter((action) => action === 'finish')).toHaveLength(20)
    expect(restarting.actions.slice(20)).toEqual(['pause', 'currentTime = 0', 'commitStyles', 'cancel'])
  })

  it('spends no more rounds on an animation whose finish() throws, and puts it on its first keyframe', async () => {
    const stuck = fakeAnimation()
    const page = openEndState({ animations: [stuck] })

    Object.assign(stuck, {
      finish: () => {
        throw new Error('InvalidStateError: the playback rate is 0.')
      },
    })

    const run = page.bringToEndState(10_000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(stuck.actions).toEqual(['pause', 'currentTime = 0', 'commitStyles', 'cancel'])
    // One frame after the round that tried it, with nothing finished to check twice, then the two last frames.
    expect(page.frames.requestFrame).toHaveBeenCalledTimes(6)
  })

  it('leaves alone animations the page paused, scroll-driven ones and those without a timeline', async () => {
    const untouched = [
      fakeAnimation({ kind: 'css-animation', playState: 'paused', currentTime: 500 }),
      fakeAnimation({ playState: 'paused', currentTime: 500, endTime: Number.POSITIVE_INFINITY }),
      fakeAnimation({ timeline: new FakeScrollTimeline() }),
      fakeAnimation({ timeline: new FakeScrollTimeline(), endTime: Number.POSITIVE_INFINITY }),
      fakeAnimation({ kind: 'css-animation', playState: 'paused', timeline: new FakeScrollTimeline() }),
      fakeAnimation({ playState: 'finished', holdsEnd: true, timeline: new FakeScrollTimeline() }),
      fakeAnimation({ timeline: null }),
    ]

    expect(await endStateOf({ animations: untouched })).toEqual(settledAnswer(false))
    expect(untouched.map((animation) => animation.actions)).toEqual(untouched.map(() => []))
  })

  it("finishes each animation once when two roots list it, and walks a root that's also recorded once", async () => {
    const shared = fakeAnimation()
    const open = fakeRoot({ animations: [shared] })
    const document = fakeDocument({ animations: [shared], openShadowRoots: [open] })

    expect(await endStateOf({ document, shadowRoots: [open] })).toEqual(settledAnswer(true))
    expect(shared.actions).toEqual(['finish'])
  })
})

describe('end events of animations the page finished', () => {
  it("run before the animations are pinned, as Storybook 11's finish() leaves them, and reach a chain's next step", async () => {
    const first = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
    const next = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
    const document = fakeDocument({ animations: [first] })
    const page = openEndState({ document })
    const actionsAtEnd: string[][] = []

    listenForEnd(page.frames, first, () => {
      actionsAtEnd.push([...first.actions])
      // The chain's next step starts, and Storybook's animationstart listener finishes it at once.
      document.animations.push(next)
      next.finish()
    })
    listenForEnd(page.frames, next, () => {
      actionsAtEnd.push([...next.actions])
    })
    // Storybook 11, right before it reports the story finished.
    first.finish()

    const run = page.bringToEndState(10_000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(actionsAtEnd).toEqual([['finish'], ['finish']])
    expect(first.actions).toEqual(['finish', 'commitStyles', 'cancel'])
    expect(next.actions).toEqual(['finish', 'commitStyles', 'cancel'])
  })

  it('are waited for when no root lists the animation, as its fill mode holds nothing, which counts as a change', async () => {
    const exit = fakeAnimation({ kind: 'css-animation' })
    const document = fakeDocument({ animations: [exit] })
    const page = openEndState({ document })
    let unmounted = false

    listenForEnd(page.frames, exit, () => {
      unmounted = true
    })
    exit.finish()
    document.animations.splice(0)

    const run = page.bringToEndState(10_000)

    await vi.advanceTimersByTimeAsync(16)
    expect(run.settled()).toBe(false)
    expect(unmounted).toBe(true)
    // Two checks a frame apart, then the two last frames, as page logic ran: each frame is two animation frames of
    // 16 ms, then a task.
    await vi.advanceTimersByTimeAsync(111)
    expect(run.settled()).toBe(false)
    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(exit.actions).toEqual(['finish'])
  })

  /**
   * How the end events of a call stop counting as pending: after two animation frames of 16 ms, or two tasks of 16 ms
   * in a page without `requestAnimationFrame`.
   */
  const clearingSteps: [string, EndStatePageParts][] = [
    ['counting animation frames', {}],
    ['counting 16 ms tasks in a page without requestAnimationFrame', { requestFrame: undefined }],
  ]

  it.each(clearingSteps)(
    'are still waited for 16 ms after the call, %s, as one made during a frame has them at the next',
    async (_steps, parts) => {
      const done = fakeAnimation({ kind: 'css-animation' })
      const page = openEndState({ animations: [done], ...parts })

      done.finish()
      await vi.advanceTimersByTimeAsync(16)

      const run = page.bringToEndState(10_000)

      await vi.advanceTimersByTimeAsync(0)
      expect(run.settled()).toBe(false)
      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
    },
  )

  it.each(clearingSteps)('are no longer waited for 32 ms after the call, %s', async (_steps, parts) => {
    const done = fakeAnimation({ kind: 'css-animation' })
    const page = openEndState({ animations: [done], ...parts })

    done.finish()
    await vi.advanceTimersByTimeAsync(32)

    const frameCalls = page.frames.requestFrame.mock.calls.length
    const timerCalls = page.setTimer.mock.calls.length

    expect(await page.bringToEndState(1000).answer).toEqual(settledAnswer(false))
    expect(page.frames.requestFrame).toHaveBeenCalledTimes(frameCalls)
    // Only the time limit's timer.
    expect(page.setTimer).toHaveBeenCalledTimes(timerCalls + 1)
  })

  it('stop counting as pending when the second animation frame of a call cannot be asked for', async () => {
    const done = fakeAnimation({ kind: 'css-animation' })
    let inCallback = false
    const requestFrame = vi.fn((callback: () => void): void => {
      if (inCallback) {
        throw new Error('NotSupportedError: no animation frame from inside one.')
      }

      setTimeout(() => {
        inCallback = true

        try {
          callback()
        } finally {
          inCallback = false
        }
      }, 16)
    })
    const page = openEndState({ animations: [done], requestFrame })

    done.finish()
    await vi.advanceTimersByTimeAsync(16)
    expect(await page.bringToEndState(1000).answer).toEqual(settledAnswer(false))
    expect(requestFrame).toHaveBeenCalledTimes(2)
  })

  it('of every animation the page finished at once run before the end state answers', async () => {
    const exits = [fakeAnimation({ kind: 'css-animation' }), fakeAnimation({ kind: 'css-animation' })]
    const page = openEndState({ animations: exits })
    const unmounted: FakeAnimation[] = []

    for (const exit of exits) {
      listenForEnd(page.frames, exit, () => {
        unmounted.push(exit)
      })
      exit.finish()
    }

    const run = page.bringToEndState(10_000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(unmounted).toEqual(exits)
  })

  it('count toward the 20 rounds when page logic finishes an animation at every end event', async () => {
    const looping = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
    const page = openEndState({ animations: [looping] })

    listenForEnd(page.frames, looping, () => looping.finish())
    looping.finish()

    const run = page.bringToEndState(10_000)

    // 20 rounds of a frame each, then the two last frames: each frame is two animation frames of 16 ms, then a task.
    await vi.advanceTimersByTimeAsync(703)
    expect(run.settled()).toBe(false)
    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    // The page finished it once more at each of the 40 animation frames of the 20 rounds, then it was pinned.
    expect(looping.actions).toEqual([...Array<string>(41).fill('finish'), 'commitStyles', 'cancel'])
  })

  it('give a timeout when the time limit passes while they are waited for', async () => {
    const looping = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
    const page = openEndState({ animations: [looping] })

    listenForEnd(page.frames, looping, () => looping.finish())
    looping.finish()

    const run = page.bringToEndState(100)

    await vi.advanceTimersByTimeAsync(99)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(animationsTimedOutAnswer())
  })
})

describe("the page's finish()", () => {
  /**
   * A page's `Animation` class whose own `finish` records each call, and throws when given `throw`.
   */
  class RecordingAnimation {
    /**
     * Each call to the class's own `finish`: what `this` was, and the arguments.
     */
    static readonly calls: { animation: unknown; values: unknown[] }[] = []

    /**
     * What the class's own `finish` throws when given `throw`.
     */
    static readonly error = new Error('InvalidStateError: the playback rate is 0.')

    /**
     * Records the call, then gives `finished`, or throws when given `throw`.
     */
    finish(...values: unknown[]): string {
      RecordingAnimation.calls.push({ animation: this, values })

      if (values[0] === 'throw') {
        throw RecordingAnimation.error
      }

      return 'finished'
    }
  }

  /**
   * The class's own `finish`.
   */
  const ownFinish = RecordingAnimation.prototype.finish

  afterEach(() => {
    RecordingAnimation.prototype.finish = ownFinish
    RecordingAnimation.calls.length = 0
  })

  it('is wrapped once, passing this, the arguments and the result through', async () => {
    const page = openEndState({ globals: { ...animationClasses, Animation: RecordingAnimation } })
    const wrapped = RecordingAnimation.prototype.finish
    const animation = new RecordingAnimation()

    expect(wrapped).not.toBe(ownFinish)
    expect(animation.finish('a', 2)).toBe('finished')
    expect(RecordingAnimation.calls).toEqual([{ animation, values: ['a', 2] }])
    expect(RecordingAnimation.calls[0]?.animation).toBe(animation)

    const run = page.bringToEndState(1000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(RecordingAnimation.prototype.finish).toBe(wrapped)
  })

  it('passes an error through, leaving no end events to wait for', async () => {
    const page = openEndState({ globals: { ...animationClasses, Animation: RecordingAnimation } })
    let thrown: unknown

    try {
      new RecordingAnimation().finish('throw')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(RecordingAnimation.error)
    expect(await page.bringToEndState(1000).answer).toEqual(settledAnswer(false))
    expect(page.frames.requestFrame).not.toHaveBeenCalled()
  })

  it("is left alone in a page whose Animation class has none, and a page without one isn't troubled", async () => {
    const { CSSAnimation, CSSTransition, DocumentTimeline } = animationClasses
    const withoutFinish = class Animation {}

    openEndState({ globals: { ...animationClasses, Animation: withoutFinish } })
    expect('finish' in withoutFinish.prototype).toBe(false)
    expect(
      await endStateOf({ animations: [fakeAnimation()], globals: { CSSAnimation, CSSTransition, DocumentTimeline } }),
    ).toEqual(settledAnswer(true))
  })
})

describe('the first keyframe and pinning', () => {
  it('puts an infinite animation on its first keyframe, then writes it into the inline style and cancels it', async () => {
    const spinner = fakeAnimation({ kind: 'css-animation', endTime: Number.POSITIVE_INFINITY })

    expect(await endStateOf({ animations: [spinner] })).toEqual(settledAnswer(true))
    expect(spinner.actions).toEqual(['pause', 'currentTime = 0', 'commitStyles', 'cancel'])
  })

  it('leaves an infinite animation on a pseudo-element paused at 0, as it takes no inline style', async () => {
    const spinner = fakeAnimation({ kind: 'css-animation', endTime: Number.POSITIVE_INFINITY, onPseudoElement: true })

    expect(await endStateOf({ animations: [spinner] })).toEqual(settledAnswer(true))
    expect(spinner.actions).toEqual(['pause', 'currentTime = 0', 'commitStyles'])
    expect(spinner.playState).toBe('paused')
    expect(spinner.currentTime).toBe(0)
  })

  it('pins an animation it paused even when seeking it to 0 throws', async () => {
    const spinner = fakeAnimation({ endTime: Number.POSITIVE_INFINITY })

    Object.defineProperty(spinner, 'currentTime', {
      get: () => 0,
      set: () => {
        throw new Error('TypeError: the current time cannot be set.')
      },
    })
    expect(await endStateOf({ animations: [spinner] })).toEqual(settledAnswer(true))
    expect(spinner.actions).toEqual(['pause', 'commitStyles', 'cancel'])
  })

  it('pins an animation it finished whose fill mode holds its end', async () => {
    const fadeIn = fakeAnimation({ kind: 'css-animation', holdsEnd: true })

    expect(await endStateOf({ animations: [fadeIn] })).toEqual(settledAnswer(true))
    expect(fadeIn.actions).toEqual(['finish', 'commitStyles', 'cancel'])
  })

  it('pins a finished animation whose fill mode holds its end, and leaves one whose fill mode does not', async () => {
    const holding = fakeAnimation({ playState: 'finished', currentTime: 1000, holdsEnd: true })
    const done = fakeAnimation({ playState: 'finished', currentTime: 1000 })

    expect(await endStateOf({ animations: [holding, done] })).toEqual(settledAnswer(true))
    expect(holding.actions).toEqual(['commitStyles', 'cancel'])
    expect(done.actions).toEqual([])
  })

  it("pins the CSS animations and transitions Storybook 11 parked at 0, and leaves a script's paused at 0", async () => {
    const parked = [
      fakeAnimation({ kind: 'css-animation', playState: 'paused' }),
      fakeAnimation({ kind: 'css-transition', playState: 'paused' }),
    ]
    const pausedByScript = fakeAnimation({ playState: 'paused' })

    expect(await endStateOf({ animations: [...parked, pausedByScript] })).toEqual(settledAnswer(true))
    expect(parked.map((animation) => animation.actions)).toEqual([
      ['commitStyles', 'cancel'],
      ['commitStyles', 'cancel'],
    ])
    expect(pausedByScript.actions).toEqual([])
  })
})

describe('the roots', () => {
  it('include every recorded shadow root and every open one, nested ones too', async () => {
    const inClosed = fakeAnimation()
    const inOpenInClosed = fakeAnimation()
    const inOpen = fakeAnimation()
    const inNested = fakeAnimation()
    const animations = [inClosed, inOpenInClosed, inOpen, inNested]
    const nested = fakeRoot({ animations: [inNested] })
    const open = fakeRoot({ animations: [inOpen], openShadowRoots: [nested] })
    const openInClosed = fakeRoot({ animations: [inOpenInClosed] })
    const closed = fakeRoot({ animations: [inClosed], openShadowRoots: [openInClosed] })
    const document = fakeDocument({ openShadowRoots: [open] })

    expect(await endStateOf({ document, shadowRoots: [closed] })).toEqual(settledAnswer(true))
    expect(animations.map((animation) => animation.actions)).toEqual(animations.map(() => ['finish']))
  })

  it("take the document's timeline from the document in a page without DocumentTimeline", async () => {
    const document = fakeDocument()
    const onDocument = fakeAnimation({ timeline: document.timeline })
    const onAnother = fakeAnimation()
    const withoutDocumentTimeline = {
      CSSAnimation: animationClasses.CSSAnimation,
      CSSTransition: animationClasses.CSSTransition,
    }

    document.animations.push(onDocument, onAnother)
    expect(await endStateOf({ document, globals: withoutDocumentTimeline })).toEqual(settledAnswer(true))
    expect(onDocument.actions).toEqual(['finish'])
    expect(onAnother.actions).toEqual([])
  })

  it("include the documents of same-origin frames, nested ones too, with their roots, on their own window's timeline", async () => {
    // A frame's window has its own DocumentTimeline class, so its animations aren't instances of the page's.
    class FrameTimeline {}
    const inFrame = fakeAnimation({ timeline: new FrameTimeline() })
    const inFrameRecorded = fakeAnimation({ timeline: new FrameTimeline() })
    const inFrameOpen = fakeAnimation({ timeline: new FrameTimeline() })
    const inInnerFrame = fakeAnimation({ timeline: new FrameTimeline() })
    const scrollDriven = fakeAnimation({ timeline: new FakeScrollTimeline() })
    const finished = [inFrame, inFrameRecorded, inFrameOpen, inInnerFrame]
    const view = { DocumentTimeline: FrameTimeline }
    const innerFrame = fakeDocument({ animations: [inInnerFrame], view })
    const frame = fakeDocument({
      animations: [inFrame, scrollDriven],
      openShadowRoots: [fakeRoot({ animations: [inFrameOpen] })],
      frames: [fakeFrameElement(innerFrame)],
      view,
    })
    const recorded = fakeRoot({ animations: [inFrameRecorded] })
    const document = fakeDocument({ frames: [fakeFrameElement(frame, [recorded]), fakeFrameElement(null)] })

    expect(await endStateOf({ document })).toEqual(settledAnswer(true))
    expect(finished.map((animation) => animation.actions)).toEqual(finished.map(() => ['finish']))
    expect(scrollDriven.actions).toEqual([])
  })

  it("take a frame's timeline from its document when its window has no DocumentTimeline", async () => {
    const frame = fakeDocument({ view: {} })
    const onFrameDocument = fakeAnimation({ timeline: frame.timeline })
    const onAnother = fakeAnimation({ timeline: new FakeScrollTimeline() })

    frame.animations.push(onFrameDocument, onAnother)
    expect(await endStateOf({ document: fakeDocument({ frames: [fakeFrameElement(frame)] }) })).toEqual(
      settledAnswer(true),
    )
    expect(onFrameDocument.actions).toEqual(['finish'])
    expect(onAnother.actions).toEqual([])
  })

  it('walk a frame showing a document already walked only once', async () => {
    const animation = fakeAnimation()
    const frame = fakeDocument({ animations: [animation] })

    Object.assign(frame, fakeRoot({ animations: [animation], frames: [fakeFrameElement(frame)] }))
    expect(await endStateOf({ document: fakeDocument({ frames: [fakeFrameElement(frame)] }) })).toEqual(
      settledAnswer(true),
    )
    expect(animation.actions).toEqual(['finish'])
  })

  it('cope with roots, elements and animations that throw', async () => {
    const fail = (): never => {
      throw new Error('unreadable')
    }
    const unreadable = fakeAnimation()
    const unpausable = fakeAnimation({ endTime: Number.POSITIVE_INFINITY })
    const document = fakeDocument({ animations: [unreadable, unpausable] })

    Object.defineProperty(unreadable, 'playState', { get: fail })
    unpausable.pause = fail
    Object.assign(document, {
      querySelectorAll: () => [
        {
          get shadowRoot() {
            return fail()
          },
        },
      ],
    })

    const broken = { getAnimations: fail, querySelectorAll: fail }

    expect(await endStateOf({ document, shadowRoots: [broken] })).toEqual(settledAnswer(false))
  })
})

describe('the time limit', () => {
  it('passing while waiting for a frame gives a timeout', async () => {
    const page = openEndState({ animations: [fakeAnimation()], requestFrame: () => undefined })
    const run = page.bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(animationsTimedOutAnswer())
  })

  it('passing while the last frames pass gives a timeout', async () => {
    const spinner = fakeAnimation({ endTime: Number.POSITIVE_INFINITY })
    const run = openEndState({ animations: [spinner] }).bringToEndState(50)

    await vi.advanceTimersByTimeAsync(50)
    expect(await run.answer).toEqual(animationsTimedOutAnswer())
  })

  it("isn't stalled by timers and frames the story replaced after the page script ran", async () => {
    const replaced = { ...animationClasses, setTimeout, clearTimeout, requestAnimationFrame: () => 0 }
    const page = openEndState({ animations: [fakeAnimation()], globals: replaced })

    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')
    page.run('globalThis.requestAnimationFrame = () => 0')

    const run = page.bringToEndState(1000)

    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
  })

  it('counts a frame as two tasks of 16 ms in a page without requestAnimationFrame', async () => {
    const page = openEndState({ animations: [fakeAnimation()], requestFrame: undefined })
    const run = page.bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(127)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(settledAnswer(true))
  })

  it('counts a frame as two tasks of 16 ms when asking for an animation frame throws', async () => {
    const requestFrame = vi.fn((): void => {
      throw new Error('NotSupportedError: no animation frames.')
    })
    const page = openEndState({ animations: [fakeAnimation()], requestFrame })
    const run = page.bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(127)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(requestFrame).toHaveBeenCalled()
  })

  it('goes on with tasks of 16 ms when asking for the second animation frame of a frame throws', async () => {
    let inCallback = false
    const requestFrame = vi.fn((callback: () => void): void => {
      if (inCallback) {
        throw new Error('NotSupportedError: no animation frame from inside one.')
      }

      setTimeout(() => {
        inCallback = true

        try {
          callback()
        } finally {
          inCallback = false
        }
      }, 16)
    })
    const page = openEndState({ animations: [fakeAnimation()], requestFrame })
    const run = page.bringToEndState(1000)

    // Each frame is an animation frame of 16 ms, then two tasks of 16 ms.
    await vi.advanceTimersByTimeAsync(191)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(settledAnswer(true))
  })
})

describe('media', () => {
  /**
   * A GIF on Storybook's own origin.
   */
  const spinner = 'http://localhost:6006/spinner.gif'

  /**
   * What the end state does to an image to replace its GIF with the first frame at `url`, at `density`: 1 by default.
   */
  function replacedWith(url: string, density = 1): string[] {
    return [`srcset = ${url} ${density}x`, 'removeAttribute src', 'decode']
  }

  describe('a video', () => {
    it('that plays is paused, stops playing on its own and is seeked to 0, then the animations are checked twice a frame apart and the last frames pass', async () => {
      const video = fakeVideo({ seekMs: 200 })
      const page = openEndState({ media: [video] })
      const run = page.bringToEndState(1000)

      await vi.advanceTimersByTimeAsync(199)
      expect(page.frames.requestFrame).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(page.frames.requestFrame).toHaveBeenCalledOnce()
      // A frame for the media events, a frame between the two checks, then the two last frames: each frame is two
      // animation frames of 16 ms, then a task.
      await vi.advanceTimersByTimeAsync(127)
      expect(run.settled()).toBe(false)
      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
      // No round finished anything.
      expect(page.frames.requestFrame).toHaveBeenCalledTimes(8)
    })

    it.each([
      ['paused away from 0', { paused: true }],
      ['paused at 0 while seeking', { paused: true, currentTime: 0, seeking: true }],
    ])('%s is seeked to 0', async (_what, options) => {
      const video = fakeVideo(options)

      expect(await endStateOf({ media: [video] })).toEqual(settledAnswer(true))
      expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    })

    it('paused at 0 keeps its poster: it only stops playing on its own, changing nothing', async () => {
      const video = fakeVideo({ paused: true, currentTime: 0 })
      const page = openEndState({ media: [video] })
      const run = page.bringToEndState(1000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(false))
      expect(video.actions).toEqual(['pause', 'autoplay = false'])
      expect(page.frames.requestFrame).not.toHaveBeenCalled()
    })

    it.each([
      ['playing, is a change', {}, true],
      ['paused, is no change', { paused: true, currentTime: 0 }, false],
    ])("that hasn't loaded anything isn't seeked, and pausing it, %s", async (_what, options, changed) => {
      const video = fakeVideo({ readyState: 0, seekMs: null, ...options })

      expect(await endStateOf({ media: [video] })).toEqual(settledAnswer(changed))
      expect(video.actions).toEqual(['pause', 'autoplay = false'])
    })

    it("without a seekable range, such as a live stream, starts no seek, so it isn't waited for", async () => {
      const video = fakeVideo({ seekable: false })

      expect(await endStateOf({ media: [video] })).toEqual(settledAnswer(true))
      expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    })

    it('paused away from 0 without a seekable range starts no seek, changing nothing', async () => {
      const video = fakeVideo({ paused: true, seekable: false })
      const page = openEndState({ media: [video] })
      const run = page.bringToEndState(1000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(false))
      expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
      expect(page.frames.requestFrame).not.toHaveBeenCalled()
    })
  })

  describe('an inline SVG', () => {
    it.each(['animate', 'animateMotion', 'animateTransform', 'set'])(
      'holding an %s element, outermost, is paused at 0, and one nested in it is left alone',
      async (holds) => {
        const outermost = fakeSvg({ holds })
        const nested = fakeSvg({ nestedIn: outermost })

        expect(await endStateOf({ media: [outermost, nested] })).toEqual(settledAnswer(true))
        expect(outermost.actions).toEqual(['pauseAnimations', 'setCurrentTime 0'])
        expect(nested.actions).toEqual([])
      },
    )

    it("that's static is paused at 0 too, changing nothing", async () => {
      const icon = fakeSvg({ holds: null })
      const page = openEndState({ media: [icon] })
      const run = page.bringToEndState(1000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(false))
      expect(icon.actions).toEqual(['pauseAnimations', 'setCurrentTime 0'])
      expect(page.frames.requestFrame).not.toHaveBeenCalled()
    })
  })

  describe('a GIF in an image', () => {
    it.each([
      ['a path ending in .gif', spinner],
      ['a path ending in .GIF', 'http://localhost:6006/SPINNER.GIF'],
      ['a query after .gif', 'http://localhost:6006/spinner.gif?v=1'],
      ['a hash after .gif', 'http://localhost:6006/spinner.gif#loop'],
      ['a data:image/gif URL', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
      ['a data:IMAGE/GIF URL', 'data:IMAGE/GIF;base64,R0lGODlhAQABAAAAACw='],
    ])('by %s is replaced with its first frame, drawn from a fresh copy', async (_what, source) => {
      const image = fakeImage({ src: source })

      expect(await endStateOf({ media: [image] })).toEqual(settledAnswer(true))
      expect(image.actions).toEqual(replacedWith(firstFrameUrl(source)))
    })

    it.each([
      ['without a srcset', 1, 1],
      ['picked from its srcset at 0.25x', 4, 0.25],
      ['picked from its srcset by width, as 1w at a size of 8px', 8, 0.125],
    ])("%s keeps its size, the first frame drawn at the GIF's pixel size", async (_what, naturalWidth, density) => {
      const image = fakeImage({ src: spinner, naturalWidth })
      const document = fakeDocument({ media: [image], files: { [spinner]: { width: 1, height: 1 } } })

      expect(await endStateOf({ document })).toEqual(settledAnswer(true))
      expect(image.actions).toEqual(replacedWith(firstFrameUrl(spinner, 1, 1), density))
    })

    it('picked from its srcset, or not picked yet, is replaced', async () => {
      const picked = fakeImage({ src: 'http://localhost:6006/still.png', currentSrc: spinner })
      const notPicked = fakeImage({ src: spinner, currentSrc: '', naturalWidth: 0 })

      expect(await endStateOf({ media: [picked, notPicked] })).toEqual(settledAnswer(true))
      expect(picked.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
      expect(notPicked.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
    })

    it("in a <picture> whose <source> picks what it shows keeps showing the GIF, so it's no change", async () => {
      const image = fakeImage({ src: spinner, pickedBySource: true })

      expect(await endStateOf({ media: [image] })).toEqual(settledAnswer(false))
      expect(image.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
    })

    it('from another origin, served with CORS, is replaced, its copy loaded with the same crossorigin', async () => {
      const source = 'https://cdn.example.com/spinner.gif'
      const image = fakeImage({ src: source, crossOrigin: 'anonymous' })
      const document = fakeDocument({ media: [image], files: { [source]: { origin: 'cross-origin-with-cors' } } })

      expect(await endStateOf({ document })).toEqual(settledAnswer(true))
      expect(image.actions).toEqual(replacedWith(firstFrameUrl(source)))
    })

    it('behind hotlink protection is replaced, its copy loaded with the same referrer policy', async () => {
      const image = fakeImage({ src: spinner, referrerPolicy: 'no-referrer' })
      const document = fakeDocument({ media: [image], files: { [spinner]: { hotlinkProtected: true } } })

      expect(await endStateOf({ document })).toEqual(settledAnswer(true))
      expect(image.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
    })

    it.each([
      ['from another origin without CORS, as drawing it taints the canvas', { origin: 'cross-origin-without-cors' }],
      ['whose copy fails to load', { arrival: 'fails' }],
    ] as const)('%s is left as it was', async (_what, file) => {
      const image = fakeImage({ src: spinner })
      const document = fakeDocument({ media: [image], files: { [spinner]: file } })

      expect(await endStateOf({ document })).toEqual(settledAnswer(false))
      expect(image.actions).toEqual([])
    })

    it("is left as it was when the document can't create its copy", async () => {
      const image = fakeImage({ src: spinner })
      const document = fakeDocument({ media: [image] })

      Object.assign(document, {
        createElement: () => {
          throw new Error('unreadable')
        },
      })
      expect(await endStateOf({ document })).toEqual(settledAnswer(false))
      expect(image.actions).toEqual([])
    })
  })

  it.each([
    'http://localhost:6006/photo.png',
    'http://localhost:6006/photo.png?name=.gif',
    'http://localhost:6006/gif',
    'data:image/png;base64,iVBORw0KGgo=',
    '',
  ])('leaves an image of %j alone', async (source) => {
    const image = fakeImage({ src: source })

    expect(await endStateOf({ media: [image] })).toEqual(settledAnswer(false))
    expect(image.actions).toEqual([])
  })

  it('are frozen in a recorded closed shadow root', async () => {
    const video = fakeVideo()
    const svg = fakeSvg()
    const image = fakeImage({ src: spinner })
    const closed = fakeRoot({ media: [video, svg, image] })

    expect(await endStateOf({ shadowRoots: [closed] })).toEqual(settledAnswer(true))
    expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    expect(svg.actions).toEqual(['pauseAnimations', 'setCurrentTime 0'])
    expect(image.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
  })

  it("are frozen in a same-origin frame's document", async () => {
    const video = fakeVideo()
    const svg = fakeSvg()
    const image = fakeImage({ src: spinner })
    const frame = fakeDocument({ media: [video, svg, image] })

    expect(await endStateOf({ document: fakeDocument({ frames: [fakeFrameElement(frame)] }) })).toEqual(
      settledAnswer(true),
    )
    expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    expect(svg.actions).toEqual(['pauseAnimations', 'setCurrentTime 0'])
    expect(image.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
  })

  it('are frozen right after the animations are pinned, and the last frames pass once, after both', async () => {
    const animation = fakeAnimation({ endTime: Number.POSITIVE_INFINITY })
    const video = fakeVideo()
    const page = openEndState({ animations: [animation], media: [video] })
    const run = page.bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(0)
    expect(animation.actions).toEqual(['pause', 'currentTime = 0', 'commitStyles', 'cancel'])
    expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    expect(page.frames.requestFrame).not.toHaveBeenCalled()
    // The frames start once the video seeked, 20 ms later.
    await vi.advanceTimersByTimeAsync(19)
    expect(page.frames.requestFrame).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(page.frames.requestFrame).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    // A frame for the media events, a frame between the two checks, then the two last frames.
    expect(page.frames.requestFrame).toHaveBeenCalledTimes(8)
  })

  it('that change nothing let no more frames pass than the animations do', async () => {
    const animation = fakeAnimation()
    const page = openEndState({
      animations: [animation],
      media: [fakeVideo({ paused: true, currentTime: 0 }), fakeSvg({ holds: null })],
    })
    const run = page.bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(127)
    expect(run.settled()).toBe(false)
    await vi.runAllTimersAsync()
    expect(await run.answer).toEqual(settledAnswer(true))
    expect(animation.actions).toEqual(['finish'])
    // As with no media: four frames of two callbacks, and the two callbacks of the finish() call's end events.
    expect(page.frames.requestFrame).toHaveBeenCalledTimes(10)
  })

  describe('starting animations as they freeze', () => {
    it("has the animations a video's pause event starts finished, and pinned when their fill mode holds their end", async () => {
      const video = fakeVideo()
      const controlsFadeIn = fakeAnimation({ kind: 'css-transition' })
      const labelFadeIn = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
      const document = fakeDocument({ media: [video] })
      const page = openEndState({ document })

      reactToMediaEvent(page.frames, video, 'pause', () => document.animations.push(controlsFadeIn, labelFadeIn))

      const run = page.bringToEndState(10_000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(controlsFadeIn.actions).toEqual(['finish'])
      expect(labelFadeIn.actions).toEqual(['finish', 'commitStyles', 'cancel'])
    })

    it("has an animation a replaced GIF's load event starts finished and pinned", async () => {
      const image = fakeImage({ src: spinner })
      const fadeIn = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
      const document = fakeDocument({ media: [image] })
      const page = openEndState({ document })

      reactToMediaEvent(page.frames, image, 'load', () => document.animations.push(fadeIn))

      const run = page.bringToEndState(10_000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(image.actions).toEqual(replacedWith(firstFrameUrl(spinner)))
      expect(fadeIn.actions).toEqual(['finish', 'commitStyles', 'cancel'])
    })

    it("puts an infinite animation a video's pause event starts on its first keyframe and pins it", async () => {
      const video = fakeVideo()
      const spinnerAnimation = fakeAnimation({ kind: 'css-animation', endTime: Number.POSITIVE_INFINITY })
      const document = fakeDocument({ media: [video] })
      const page = openEndState({ document })

      reactToMediaEvent(page.frames, video, 'pause', () => document.animations.push(spinnerAnimation))

      const run = page.bringToEndState(10_000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(spinnerAnimation.actions).toEqual(['pause', 'currentTime = 0', 'commitStyles', 'cancel'])
    })

    it('finishes an animation page logic starts a frame after a media event, past the first quiet check', async () => {
      const video = fakeVideo()
      const late = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
      const document = fakeDocument({ media: [video] })
      const page = openEndState({ document })

      // The frame for the media events spans animation frames 1 and 2, so the frame after the first quiet check
      // starts at 3.
      reactToMediaEvent(page.frames, video, 'pause', () => page.frames.react(2, () => document.animations.push(late)))

      const run = page.bringToEndState(10_000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(late.actions).toEqual(['finish', 'commitStyles', 'cancel'])
    })

    it('waits for the end events of an animation the page finishes as it starts, as Storybook 11 does, before pinning it', async () => {
      const video = fakeVideo()
      const fadeIn = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
      const document = fakeDocument({ media: [video] })
      const page = openEndState({ document })
      const actionsAtEnd: string[][] = []

      listenForEnd(page.frames, fadeIn, () => {
        actionsAtEnd.push([...fadeIn.actions])
      })
      // The frame for the media events spans animation frames 1 and 2, and the frame after the first quiet check 3
      // and 4. The fade-in starts at 4, the last before the second check, and Storybook's animationstart listener
      // finishes it at once, so its end events are still pending at that check.
      reactToMediaEvent(page.frames, video, 'pause', () =>
        page.frames.react(3, () => {
          document.animations.push(fadeIn)
          fadeIn.finish()
        }),
      )

      const run = page.bringToEndState(10_000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(actionsAtEnd).toEqual([['finish']])
      expect(fadeIn.actions).toEqual(['finish', 'commitStyles', 'cancel'])
    })

    it('freezes media only once, before it brings the animations to their end again', async () => {
      const video = fakeVideo()
      const fadeIn = fakeAnimation({ kind: 'css-animation', holdsEnd: true })
      const document = fakeDocument({ media: [video] })
      const page = openEndState({ document })

      reactToMediaEvent(page.frames, video, 'pause', () => document.animations.push(fadeIn))

      const run = page.bringToEndState(10_000)

      await vi.runAllTimersAsync()
      expect(await run.answer).toEqual(settledAnswer(true))
      expect(video.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    })

    it.each([
      ['while page logic runs on the media events', 40],
      ['while it finishes what that started', 60],
    ])('gives a timeout naming the animations when the time limit passes %s', async (_when, timeoutMs) => {
      const video = fakeVideo()
      const document = fakeDocument({ media: [video] })
      const page = openEndState({ document })

      reactToMediaEvent(page.frames, video, 'pause', () => document.animations.push(fakeAnimation()))

      const run = page.bringToEndState(timeoutMs)

      await vi.advanceTimersByTimeAsync(timeoutMs - 1)
      expect(run.settled()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await run.answer).toEqual(animationsTimedOutAnswer())
    })
  })

  it('that throw are coped with', async () => {
    const fail = (): never => {
      throw new Error('unreadable')
    }
    const unpausable = Object.assign(fakeVideo(), { pause: fail })
    const unseekable = fakeVideo()
    const deaf = Object.assign(fakeVideo(), { addEventListener: fail })
    const withoutAnimations = Object.assign(fakeSvg(), { pauseAnimations: undefined })
    const unpausableSvg = Object.assign(fakeSvg(), { pauseAnimations: fail })
    const unsearchable = Object.assign(fakeSvg(), { querySelector: fail })
    const unreadable = fakeImage({ src: spinner })
    const undecodable = Object.assign(fakeImage({ src: spinner }), {
      decode: () => Promise.reject(new Error('EncodingError: the image cannot be decoded.')),
    })
    const media = [
      unpausable,
      unseekable,
      deaf,
      withoutAnimations,
      unpausableSvg,
      unsearchable,
      unreadable,
      undecodable,
    ]

    Object.defineProperty(unseekable, 'currentTime', { set: fail })
    Object.defineProperty(unreadable, 'currentSrc', { get: fail })
    expect(await endStateOf({ media })).toEqual(settledAnswer(true))
    expect(unpausable.actions).toEqual([])
    expect(unseekable.actions).toEqual(['pause', 'autoplay = false'])
    expect(deaf.actions).toEqual(['pause', 'autoplay = false', 'currentTime = 0'])
    expect(unsearchable.actions).toEqual(['pauseAnimations', 'setCurrentTime 0'])
    expect(unreadable.actions).toEqual([])
    expect(undecodable.actions).toEqual(replacedWith(firstFrameUrl(spinner)).slice(0, 2))
  })

  it('leave no rejection unhandled when a video takes neither the seeked listener nor a seek', async () => {
    const unhandled = vi.fn()
    const video = Object.assign(fakeVideo(), {
      addEventListener: () => {
        throw new Error('unreadable')
      },
    })

    Object.defineProperty(video, 'currentTime', {
      set: () => {
        throw new Error('unreadable')
      },
    })
    process.on('unhandledRejection', unhandled)

    try {
      expect(await endStateOf({ media: [video] })).toEqual(settledAnswer(true))
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('passing while a video seeks gives a timeout naming the media', async () => {
    const run = openEndState({ media: [fakeVideo({ seekMs: null })] }).bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(mediaTimedOutAnswer())
  })

  it("passing while a GIF's copy loads gives a timeout naming the media", async () => {
    const document = fakeDocument({ media: [fakeImage({ src: spinner })], files: { [spinner]: { arrival: 'stalls' } } })
    const run = openEndState({ document }).bringToEndState(1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(mediaTimedOutAnswer())
  })

  it('passing while the last frames pass after media changed gives a timeout naming the media', async () => {
    // The video seeks for 20 ms, then the animations are checked over two frames of 32 ms, until 84 ms.
    const run = openEndState({ media: [fakeVideo()] }).bringToEndState(100)

    await vi.advanceTimersByTimeAsync(99)
    expect(run.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run.answer).toEqual(mediaTimedOutAnswer())
  })
})

describe('readEndState', () => {
  it.each([true, false])('reads an end state that settled, with changed %s', (changed) => {
    expect(readEndState(settledAnswer(changed))).toEqual({ outcome: 'settled', changed })
  })

  it('reads a timeout while animations finished', () => {
    expect(readEndState(animationsTimedOutAnswer())).toEqual({ outcome: 'timed-out', step: 'animations' })
  })

  it('reads a timeout while media were put on their first frame', () => {
    expect(readEndState(mediaTimedOutAnswer())).toEqual({ outcome: 'timed-out', step: 'media' })
  })

  it('reads a missing page script', () => {
    expect(readEndState({ outcome: 'script-missing' })).toEqual({ outcome: 'script-missing' })
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['a settled end state without changed', { outcome: 'settled' }],
    ['changed other than true or false', settledAnswer('yes')],
    ['a timeout without a step', { outcome: 'timed-out' }],
    ['a timeout in another step', { outcome: 'timed-out', step: 'fonts' }],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readEndState(value)).toThrow(
      `The end state in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })
})
