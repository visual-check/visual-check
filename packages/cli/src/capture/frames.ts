/**
 * How long each of a frame's two tasks lasts in a page without `requestAnimationFrame`, in ms.
 */
export const taskFrameMs = 16

/**
 * The source of a function, evaluated in the page as part of the page script, that gives `framesPassedBefore(count,
 * deadline)`. It takes what the page script kept at document start: the browser's own `setTimer` and `requestFrame`
 * (`undefined` in a page without `requestAnimationFrame`). `framesPassedBefore` lets `count` frames pass, one after
 * the other, and resolves true, or false as soon as `deadline`, a promise, settles first.
 *
 * A frame is two `requestFrame` callbacks, then a task, so a rendering update runs and the page logic it queues, such as
 * an `IntersectionObserver`'s callback, runs after it. In a page without `requestFrame`, or when asking for the first
 * callback throws, it's two tasks of 16 ms, and when only asking for the second throws, it's one callback, then two
 * tasks of 16 ms. A task that can't be scheduled ends the frame at once, so a frame never throws, in its callbacks
 * either, and never stays pending.
 */
export const framesFunction = `(context) => {
  const { setTimer, requestFrame } = context
  const passed = Symbol('passed')

  const frame = () =>
    new Promise((resolve) => {
      const task = (callback, ms) => {
        try {
          setTimer(callback, ms)
        } catch {
          resolve()
        }
      }
      const tasks = () => task(() => task(resolve, ${taskFrameMs}), ${taskFrameMs})
      const animationFrame = (callback) => {
        if (requestFrame === undefined) {
          tasks()
          return
        }
        try {
          requestFrame(callback)
        } catch {
          tasks()
        }
      }
      animationFrame(() => animationFrame(() => task(resolve, 0)))
    })

  return async (count, deadline) => {
    for (let frames = 0; frames < count; frames += 1) {
      if ((await Promise.race([frame().then(() => passed), deadline])) !== passed) {
        return false
      }
    }
    return true
  }
}`
