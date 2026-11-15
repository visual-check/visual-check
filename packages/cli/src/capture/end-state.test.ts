import { createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  animationClasses,
  type FakeAnimation,
  FakeScrollTimeline,
  fakeAnimation,
} from '../storybook/preview-script.fixture.js'
import { parkedByStorybookSource } from '../storybook/preview-script.js'
import { animationsTimedOutAnswer, FakeFrames, fakeDocument, fakeRoot, settledAnswer } from './end-state.fixture.js'
import { endStateFunction, readEndState } from './end-state.js'

/**
 * What a fake page for the end state has.
 */
interface EndStatePageParts {
  /**
   * The page's document: one holding `animations` by default.
   */
  document?: object
  /**
   * The animations in the page's document, when `document` isn't given: none by default.
   */
  animations?: FakeAnimation[]
  /**
   * The shadow roots the page script recorded: none by default.
   */
  shadowRoots?: object[]
  /**
   * The page's globals besides `document`: the fake Web Animations classes by default.
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
  const { animations = [], shadowRoots = [], globals = animationClasses } = parts
  const document = parts.document ?? fakeDocument({ animations })
  const frames = new FakeFrames()
  const requestFrame = 'requestFrame' in parts ? parts.requestFrame : frames.requestFrame
  const context = createContext({ ...globals, document })
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
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
    expect(page.frames.requestFrame).toHaveBeenCalledTimes(8)
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
})

describe('readEndState', () => {
  it.each([true, false])('reads an end state that settled, with changed %s', (changed) => {
    expect(readEndState(settledAnswer(changed))).toEqual({ outcome: 'settled', changed })
  })

  it('reads a timeout while animations finished', () => {
    expect(readEndState(animationsTimedOutAnswer())).toEqual({ outcome: 'timed-out', step: 'animations' })
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
    ['a timeout in another step', { outcome: 'timed-out', step: 'media' }],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readEndState(value)).toThrow(
      `The end state in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })
})
