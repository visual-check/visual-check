/**
 * How many rounds of finishing animations the end state runs at most.
 */
const maxRounds = 20

/**
 * How long each of a frame's two tasks lasts in a page without `requestAnimationFrame`, in ms.
 */
const taskFrameMs = 16

/**
 * The source of a function, evaluated in the page as part of the page script, that creates the end state. It takes
 * what the page script kept at document start: `shadowRoots`, the browser's own `setTimer`, `clearTimer` and
 * `requestFrame` (`undefined` in a page without `requestAnimationFrame`), and `parkedByStorybook`, the Storybook
 * adapter's predicate for the animations Storybook 11 parked. It gives a function that takes a time limit in ms and
 * brings the page to its end state, in the document and in every shadow root: the recorded ones, and every open one
 * found by walking each root's elements, again at every check.
 *
 * 1. Settles: calls `finish()` on every running finite animation, lets a frame pass so end events run page logic, and
 *    checks again, until two checks a frame apart find nothing finite running, for at most 20 rounds. A story with
 *    nothing running waits no frame. An animation whose `finish()` throws isn't tried again.
 * 2. Puts every animation still running on its first keyframe, with `pause()` then `currentTime = 0`, as Storybook 11
 *    does: infinite ones, finite ones whose `finish()` threw, and finite ones still starting after 20 rounds. One that
 *    paused counts as parked even when it can't be seeked to 0.
 * 3. Pins what Chromium might paint stale: every animation step 2 parked, every one Storybook 11 parked, and every
 *    finished one whose fill mode still holds its end. It writes each into the element's inline style with
 *    `commitStyles()`, then cancels it. A pseudo-element can't take an inline style, so its animation stays as it is.
 * 4. Lets two more frames pass when it changed anything, as a change made just before capture can still be rastering
 *    on a busy machine.
 *
 * A frame is two `requestFrame` callbacks, then a task, or two tasks of 16 ms in a page without it. Only animations
 * on the document's timeline are touched: scroll-driven and view-driven ones, and those with no timeline, are left
 * alone, and so are those the page paused itself, Storybook 11's aside.
 *
 * It answers `{ outcome: 'settled', changed }`, where `changed` says whether it finished, parked or pinned anything.
 * When the time limit passes while it waits for a frame, it answers `{ outcome: 'timed-out', step: 'animations' }`.
 * It never throws: every call into the page is guarded.
 */
export const endStateFunction = `(context) => {
  const { shadowRoots, setTimer, clearTimer, requestFrame, parkedByStorybook } = context
  const timedOut = Symbol('timed out')

  // Collecting the animations: every root, then every animation on the document's timeline in them, each once.

  const elementsOf = (root) => {
    try {
      return Array.from(root.querySelectorAll('*'))
    } catch {
      return []
    }
  }

  const openShadowRootOf = (element) => {
    try {
      const root = element.shadowRoot
      return typeof root === 'object' && root !== null ? root : undefined
    } catch {
      return undefined
    }
  }

  const rootsOf = () => {
    const roots = new Set([document, ...shadowRoots])
    // A Set's iteration visits the roots added during it, so the open roots inside open roots are walked too.
    for (const root of roots) {
      for (const element of elementsOf(root)) {
        const openRoot = openShadowRootOf(element)
        if (openRoot !== undefined) {
          roots.add(openRoot)
        }
      }
    }
    return roots
  }

  const animationsIn = (root) => {
    try {
      return Array.from(root.getAnimations())
    } catch {
      return []
    }
  }

  const onDocumentTimeline = (animation) => {
    try {
      const timeline = animation.timeline
      if (typeof DocumentTimeline === 'function') {
        return timeline instanceof DocumentTimeline
      }
      return typeof timeline === 'object' && timeline !== null && timeline === document.timeline
    } catch {
      return false
    }
  }

  const animationsOf = (roots) => {
    const animations = new Set()
    for (const root of roots) {
      for (const animation of animationsIn(root)) {
        animations.add(animation)
      }
    }
    return Array.from(animations).filter(onDocumentTimeline)
  }

  // Reading an animation, never throwing.

  const playStateOf = (animation) => {
    try {
      return animation.playState
    } catch {
      return undefined
    }
  }

  const isFiniteAnimation = (animation) => {
    try {
      return Number.isFinite(animation.effect.getComputedTiming().endTime)
    } catch {
      return false
    }
  }

  const holdsItsEnd = (animation) => {
    try {
      return animation.effect.getComputedTiming().progress !== null
    } catch {
      return false
    }
  }

  // The steps after settling.

  const park = (animations) => {
    const parked = new Set()
    for (const animation of animations) {
      if (playStateOf(animation) !== 'running') {
        continue
      }
      try {
        animation.pause()
      } catch {
        continue
      }
      parked.add(animation)
      try {
        animation.currentTime = 0
      } catch {}
    }
    return parked
  }

  const pin = (animations, parked) => {
    let pinned = 0
    for (const animation of animations) {
      const finishedHoldingEnd = playStateOf(animation) === 'finished' && holdsItsEnd(animation)
      if (!parked.has(animation) && !parkedByStorybook(animation) && !finishedHoldingEnd) {
        continue
      }
      try {
        animation.commitStyles()
        animation.cancel()
        pinned += 1
      } catch {}
    }
    return pinned
  }

  // A frame: two animation frames, then a task.

  const frame = () =>
    new Promise((resolve) => {
      if (requestFrame === undefined) {
        setTimer(() => setTimer(resolve, ${taskFrameMs}), ${taskFrameMs})
        return
      }
      requestFrame(() => requestFrame(() => setTimer(resolve, 0)))
    })

  return async (timeoutMs) => {
    let timer
    const deadline = new Promise((resolve) => {
      timer = setTimer(() => resolve(timedOut), timeoutMs)
    })
    const framesPassed = async (count) => {
      for (let passed = 0; passed < count; passed += 1) {
        if ((await Promise.race([frame(), deadline])) === timedOut) {
          return false
        }
      }
      return true
    }
    try {
      // Animations whose finish() threw, such as one with a playback rate of 0, aren't finished again: they're put on
      // their first keyframe with the infinite ones.
      const unfinishable = new Set()
      let finished = 0
      let rounds = 0
      let quietChecks = 0
      for (;;) {
        const running = animationsOf(rootsOf()).filter(
          (animation) =>
            !unfinishable.has(animation) && playStateOf(animation) === 'running' && isFiniteAnimation(animation),
        )
        if (running.length === 0) {
          quietChecks += 1
          if (finished === 0 || quietChecks === 2) {
            break
          }
        } else {
          quietChecks = 0
          if (rounds === ${maxRounds}) {
            break
          }
          for (const animation of running) {
            try {
              animation.finish()
              finished += 1
            } catch {
              unfinishable.add(animation)
            }
          }
          rounds += 1
        }
        if (!(await framesPassed(1))) {
          return { outcome: 'timed-out', step: 'animations' }
        }
      }
      const parked = park(animationsOf(rootsOf()))
      const pinned = pin(animationsOf(rootsOf()), parked)
      const changed = finished > 0 || parked.size > 0 || pinned > 0
      if (changed && !(await framesPassed(2))) {
        return { outcome: 'timed-out', step: 'animations' }
      }
      return { outcome: 'settled', changed }
    } finally {
      clearTimer(timer)
    }
  }
}`

/**
 * What bringing the page to its end state found.
 */
export type EndState =
  | {
      /**
       * The page is at its end state.
       */
      outcome: 'settled'
      /**
       * Whether it finished, parked or pinned any animation, so images that came into view may need loading.
       */
      changed: boolean
    }
  | {
      /**
       * The time limit passed while it waited for a frame.
       */
      outcome: 'timed-out'
      /**
       * It was finishing the page's animations.
       */
      step: 'animations'
    }
  | {
      /**
       * The page script hadn't run in the page, so there was nothing to bring the page to its end state with.
       */
      outcome: 'script-missing'
    }

/**
 * Reads the value the end state expression gave. Throws, quoting the value, when it's not an answer the page gives.
 */
export function readEndState(value: unknown): EndState {
  const answer: Record<string, unknown> = typeof value === 'object' && value !== null ? { ...value } : {}

  if (answer.outcome === 'settled' && typeof answer.changed === 'boolean') {
    return { outcome: 'settled', changed: answer.changed }
  }

  if (answer.outcome === 'timed-out' && answer.step === 'animations') {
    return { outcome: 'timed-out', step: 'animations' }
  }

  if (answer.outcome === 'script-missing') {
    return { outcome: 'script-missing' }
  }

  throw new Error(`The end state in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`)
}
