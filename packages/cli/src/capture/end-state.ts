import { pageRootsFunction } from './page-roots.js'

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
 * `requestFrame` (`undefined` in a page without `requestAnimationFrame`), `parkedByStorybook`, the Storybook adapter's
 * predicate for the animations Storybook 11 parked, and `stateGlobal`, the name of the global it keeps its state under
 * in every document. It gives a function that takes a time limit in ms and brings the page to its end state, in the
 * document and in every shadow root: the recorded ones, and every open one found by walking each root's elements. It
 * does so in the document of every reachable frame too, as a same-origin or `srcdoc` one's is, with the closed shadow
 * roots the frame's own page script recorded, its open shadow roots and the frames in it. It walks them all again at
 * every check.
 *
 * When it's created, at document start, it wraps `Animation.prototype.finish`, where the page has it, to note each
 * call that doesn't throw. The browser dispatches the end events of an animation finished by a call only at the next
 * rendering update, and Storybook 11 finishes every CSS animation and transition right before `storyFinished`, and
 * every one that starts later. Pinning such an animation before then would cancel it, so its `animationend` would
 * become `animationcancel`, and page logic waiting for it, such as a chained animation's next step or an exit that
 * unmounts, would never run. A call's end events count as pending until two animation frames passed since the latest
 * call, or two tasks of 16 ms in a page without `requestAnimationFrame`: a call made in an event listener during a
 * rendering update has them in the next update, while a callback asked for during the first update's events still
 * runs in that update. The wrapper passes `this`, the arguments, the result and any error through, so it changes
 * nothing the page sees. The end state's own `finish()` calls go through it too.
 *
 * 1. Settles: calls `finish()` on every running finite animation, lets a frame pass so end events run page logic, and
 *    checks again. A check that finds end events pending from a `finish()` call lets a frame pass too. It goes on
 *    until two checks a frame apart find neither, for at most 20 rounds, each a check that found either. A story with
 *    nothing running and nothing pending waits no frame. An animation whose `finish()` throws isn't tried again.
 * 2. Puts every animation still running on its first keyframe, with `pause()` then `currentTime = 0`, as Storybook 11
 *    does: infinite ones, finite ones whose `finish()` threw, and finite ones still starting after 20 rounds. One that
 *    paused counts as parked even when it can't be seeked to 0.
 * 3. Pins what Chromium might paint stale: every animation step 2 parked, every one Storybook 11 parked, and every
 *    finished one whose fill mode still holds its end. It writes each into the element's inline style with
 *    `commitStyles()`, then cancels it. A pseudo-element can't take an inline style, so its animation stays as it is.
 * 4. Freezes media:
 *    - It pauses every video and stops it playing on its own, so one still loading doesn't start later. It seeks one
 *      that was moving (playing, away from 0 or seeking) and has loaded anything to 0, and when a seek starts, it
 *      waits for its `seeked` event, which comes once the frame is decoded. A video without a seekable range, such as
 *      a live stream or a MediaStream in `srcObject` (a webcam or call preview), starts no seek, and counts as a
 *      change only when it was playing. A paused video at 0 isn't seeked, so it keeps its poster.
 *    - It pauses the animations of every outermost inline SVG at 0. Every SVG has a running clock, so only one holding
 *      SMIL animation elements counts as a change: SMIL reached only through `<use>` is paused but doesn't count.
 *    - It replaces every GIF in an `<img>`, by a `data:image/gif` URL or a URL whose path ends in `.gif`, with its
 *      first frame. `drawImage()` draws an animated image's default frame, its first, as the HTML spec says. So it
 *      loads a fresh copy, with the image's `crossorigin` and referrer policy, for the GIF's pixel size without any
 *      `srcset` density, and draws it on a canvas. The canvas's data URL becomes the image's only `srcset` candidate,
 *      at the density that keeps the image's size, the image loses its `src`, and it's decoded. It counts once the
 *      image shows the frame. A GIF whose copy fails to load is left as it is, and so is a cross-origin one without
 *      CORS, as it taints the canvas. A GIF that isn't animated, such as a logo or a spacer, is replaced too and
 *      counts as a change, though it shows the same pixels: there's no cheap way to tell an animated GIF from a still
 *      one.
 * 5. When step 4 changed anything, lets a frame pass, so the events freezing media fired, such as a video's `pause`
 *    and `seeked` or a replaced GIF's `load`, run page logic: a custom player's controls fading in when its video
 *    pauses, say. Then it runs steps 1 to 3 once more, with 20 rounds of its own, the settling going on until two
 *    checks a frame apart find nothing running and nothing pending, as page logic reacting to an event can start an
 *    animation a frame later, once a framework commits. It doesn't freeze media again. When step 4 changed nothing,
 *    this costs nothing.
 * 6. Lets two more frames pass when it changed anything, as a change made just before capture can still be rastering
 *    on a busy machine.
 *
 * A frame is two `requestFrame` callbacks, then a task. In a page without `requestFrame`, or when asking for the first
 * callback throws, it's two tasks of 16 ms, and when only asking for the second throws, it's one callback, then two
 * tasks of 16 ms. Only animations on their document's timeline are touched, a frame's own for one in a frame:
 * scroll-driven and view-driven ones, and those with no timeline, are left alone, and so are those the page paused
 * itself, Storybook 11's aside. Only `finish()` calls made in the top document are noted: a frame's own calls aren't,
 * though the end state's calls on a frame's animations still wait two quiet checks a frame apart.
 *
 * Left to the project, through a mask or a `wait` hook: SVG in `<img>`, GIFs as CSS backgrounds or cross-origin
 * without CORS, APNG, animated WebP, canvas, Lottie and other script-driven motion, and a video that hasn't loaded
 * anything. An `<img>` inside `<picture>` keeps showing what its `<source>` picks.
 *
 * It answers `{ outcome: 'settled', changed }`, where `changed` says whether it changed anything that was moving: it
 * finished, parked or pinned an animation, paused a playing video or seeked a moving one, paused an SVG holding SMIL
 * animation elements, or replaced a GIF the image then shows. Waiting for end events pending from a `finish()` call
 * counts too, as page logic ran on them: an exit may unmount, a mount may bring images. When the time limit passes
 * while it settles the animations, or, after media changed, during the frame that lets media events run or the
 * settling after it, it answers `{ outcome: 'timed-out', step: 'animations' }`. While it waits for media, or for the
 * last frames after media changed, it answers `{ outcome: 'timed-out', step: 'media' }`, and during the last frames
 * after only animations changed, `step: 'animations'`. It never throws: every call into the page is guarded.
 */
export const endStateFunction = `(context) => {
  const { shadowRoots, setTimer, clearTimer, requestFrame, parkedByStorybook, stateGlobal } = context
  const timedOut = Symbol('timed out')

  // Noting finish() calls: their end events are pending until two animation frames passed since the latest call.

  let finishCalls = 0
  let endEventsPending = false

  const noteFinishCall = () => {
    try {
      const call = finishCalls + 1
      const clearIfLatest = () => {
        if (call === finishCalls) {
          endEventsPending = false
        }
      }
      const nextStep = (callback) => {
        if (requestFrame === undefined) {
          setTimer(callback, ${taskFrameMs})
        } else {
          requestFrame(callback)
        }
      }
      // The second step clears at once when it can't be scheduled, so a failure never leaves them pending.
      nextStep(() => {
        try {
          nextStep(clearIfLatest)
        } catch {
          clearIfLatest()
        }
      })
      // Noted only once the clearing is on its way, so a call that can't schedule it never leaves them pending.
      finishCalls = call
      endEventsPending = true
    } catch {}
  }

  try {
    if (typeof Animation === 'function' && typeof Animation.prototype.finish === 'function') {
      const apply = Reflect.apply
      const originalFinish = Animation.prototype.finish
      Animation.prototype.finish = function finish() {
        const result = apply(originalFinish, this, arguments)
        noteFinishCall()
        return result
      }
    }
  } catch {}

  // Collecting the animations: every root, then every animation on its document's timeline in them, each once.

  const { elementsOf, rootsOf, read, isObject, recordedRootsOf } = (${pageRootsFunction})()

  // Every root, each mapped to its document: the top document's roots, then those of every reachable frame's document,
  // as a same-origin or srcdoc one's is, with the shadow roots the frame's own page script recorded, nested frames too.
  const allRoots = () => {
    const documents = new Map()
    const visit = (rootDocument, recordedRoots) => {
      const roots = rootsOf(rootDocument, recordedRoots)
      for (const root of roots) {
        documents.set(root, rootDocument)
      }
      for (const root of roots) {
        for (const frame of elementsOf(root, 'iframe, frame')) {
          const frameDocument = read(() => frame.contentDocument, null)
          if (isObject(frameDocument) && !documents.has(frameDocument)) {
            visit(frameDocument, recordedRootsOf(frame, stateGlobal))
          }
        }
      }
    }
    visit(document, shadowRoots)
    return documents
  }

  const animationsIn = (root) => {
    try {
      return Array.from(root.getAnimations())
    } catch {
      return []
    }
  }

  // Whether an animation runs on its document's timeline. A frame's timeline is made by the frame's window, so it's
  // checked against that window's DocumentTimeline, not the top window's.
  const onDocumentTimeline = (animation, rootDocument) => {
    try {
      const timeline = animation.timeline
      const ownClass = read(() => rootDocument.defaultView.DocumentTimeline, undefined)
      const timelineClass = typeof ownClass === 'function' ? ownClass : globalThis.DocumentTimeline
      if (typeof timelineClass === 'function') {
        return timeline instanceof timelineClass
      }
      return isObject(timeline) && timeline === rootDocument.timeline
    } catch {
      return false
    }
  }

  const animationsOf = (roots) => {
    const animations = new Set()
    for (const [root, rootDocument] of roots) {
      for (const animation of animationsIn(root)) {
        if (!animations.has(animation) && onDocumentTimeline(animation, rootDocument)) {
          animations.add(animation)
        }
      }
    }
    return Array.from(animations)
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

  // Freezing media. Each kind gives, or promises, whether it changed something that was moving, and never throws or
  // rejects.

  const hasLoadedAnything = (video) => {
    try {
      return video.readyState > 0
    } catch {
      return false
    }
  }

  // Whether a video is playing, and whether it's moving: playing, away from 0 or seeking.
  const motionOf = (video) => {
    try {
      const playing = !video.paused
      return { playing, moving: playing || video.currentTime !== 0 || video.seeking === true }
    } catch {
      return { playing: false, moving: false }
    }
  }

  const isSeeking = (video) => {
    try {
      return video.seeking === true
    } catch {
      return false
    }
  }

  // Pauses a video and stops it playing on its own, so one still loading doesn't start later. Seeks one that was
  // moving and has loaded anything to 0, and waits for its seeked event, which comes once the frame is decoded. A
  // paused video at 0 isn't seeked, as that would replace its poster with the frame. Chromium sets seeking at once
  // when a seek starts, and a video without a seekable range, such as a live stream or a MediaStream in srcObject (a
  // webcam or call preview), starts none: it changed only when it was playing.
  const freezeVideo = (video) => {
    const { playing, moving } = motionOf(video)
    try {
      video.pause()
    } catch {
      return false
    }
    try {
      video.autoplay = false
    } catch {}
    if (!moving || !hasLoadedAnything(video)) {
      return playing
    }
    try {
      // Caught now: when the listener can't be added and the seek then throws, nothing else would handle it.
      const seeked = new Promise((resolve) => {
        video.addEventListener('seeked', () => resolve(true), { once: true })
      }).catch(() => true)
      video.currentTime = 0
      return isSeeking(video) ? seeked : playing
    } catch {
      return playing
    }
  }

  // Pauses the animations of an outermost inline SVG at 0: an SVG nested in another shares the outermost one's. Every
  // SVG has a running clock, so only one holding SMIL animation elements counts as a change.
  const freezeSvg = (svg) => {
    try {
      if (svg.ownerSVGElement !== null || typeof svg.pauseAnimations !== 'function') {
        return false
      }
      svg.pauseAnimations()
    } catch {
      return false
    }
    try {
      svg.setCurrentTime(0)
    } catch {}
    try {
      return svg.querySelector('animate, animateMotion, animateTransform, set') !== null
    } catch {
      return false
    }
  }

  // The source of an image showing a GIF: a data:image/gif URL, or a URL whose path ends in .gif.
  const gifSourceOf = (image) => {
    try {
      const source = image.currentSrc || image.src
      if (typeof source !== 'string' || source === '') {
        return undefined
      }
      const url = new URL(source, document.baseURI)
      const isGif =
        url.protocol === 'data:'
          ? url.pathname.split(/[;,]/)[0].trim().toLowerCase() === 'image/gif'
          : url.pathname.toLowerCase().endsWith('.gif')
      return isGif ? source : undefined
    } catch {
      return undefined
    }
  }

  // Draws a loaded image on a canvas at its pixel size, and gives the canvas's data URL with that width. drawImage()
  // draws an animated image's default frame, its first, as the HTML spec says. A cross-origin image without CORS
  // taints the canvas, so toDataURL() throws.
  const drawn = (image) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d').drawImage(image, 0, 0)
      return { url: canvas.toDataURL(), width: image.naturalWidth }
    } catch {
      return undefined
    }
  }

  // Loads a fresh copy of a GIF, with the image's crossorigin and referrer policy, and draws it. The copy has the GIF's
  // pixel size, as no srcset or density applies to it. Gives undefined when it can't.
  const firstFrameOf = (image, source) =>
    new Promise((resolve) => {
      try {
        const copy = document.createElement('img')
        const { crossOrigin, referrerPolicy } = image
        if (typeof crossOrigin === 'string') {
          copy.crossOrigin = crossOrigin
        }
        if (typeof referrerPolicy === 'string') {
          copy.referrerPolicy = referrerPolicy
        }
        copy.addEventListener('load', () => resolve(drawn(copy)), { once: true })
        copy.addEventListener('error', () => resolve(undefined), { once: true })
        copy.src = source
      } catch {
        resolve(undefined)
      }
    })

  // Replaces a GIF in an image with its first frame, as the only candidate of its srcset, at the density that keeps
  // its size: an image's naturalWidth is in CSS pixels, at the density of the candidate it picked. Counts it only once
  // the image shows the frame: one in a <picture> whose <source> picks what it shows keeps showing the GIF.
  const freezeGif = async (image) => {
    const source = gifSourceOf(image)
    if (source === undefined) {
      return false
    }
    const frame = await firstFrameOf(image, source)
    if (frame === undefined) {
      return false
    }
    try {
      const shownWidth = image.naturalWidth
      const density = shownWidth > 0 ? frame.width / shownWidth : 1
      image.srcset = frame.url + ' ' + density + 'x'
      image.removeAttribute('src')
    } catch {
      return false
    }
    try {
      await image.decode()
    } catch {}
    try {
      return image.currentSrc === frame.url
    } catch {
      return false
    }
  }

  // Freezes every video, inline SVG and GIF in an image in the roots.
  const freezeMedia = (roots) => {
    const elements = (selector) => Array.from(roots.keys()).flatMap((root) => elementsOf(root, selector))
    return [
      ...elements('video').map(freezeVideo),
      ...elements('svg').map(freezeSvg),
      ...elements('img').map(freezeGif),
    ]
  }

  // A frame: two animation frames, then a task. Without requestFrame, or from the point where asking for an animation
  // frame throws, it goes on with two tasks of 16 ms instead. A task that can't be scheduled ends the frame at once, so
  // a frame never throws, in its callbacks either, and never stays pending.

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
    // Animations whose finish() threw, such as one with a playback rate of 0, aren't finished again: they're put on
    // their first keyframe with the infinite ones.
    const unfinishable = new Set()
    // Settles the animations, then puts those still running on their first keyframe and pins them. Gives whether it
    // changed anything and the roots its last check walked, or timedOut. After media changed, it stops only at two quiet
    // checks a frame apart, even when nothing ran before, as page logic reacting to a media event can start an
    // animation a frame later.
    const endAnimations = async ({ afterMedia }) => {
      let changed = false
      let rounds = 0
      let quietChecks = 0
      let roots
      for (;;) {
        roots = allRoots()
        const running = animationsOf(roots).filter(
          (animation) =>
            !unfinishable.has(animation) && playStateOf(animation) === 'running' && isFiniteAnimation(animation),
        )
        if (running.length === 0 && !endEventsPending) {
          quietChecks += 1
          // Nothing finished and no end events waited for: no page logic ran that could start another animation, unless
          // an event did, as after media changed.
          if (quietChecks === 2 || (!changed && !afterMedia)) {
            break
          }
        } else {
          quietChecks = 0
          if (rounds === ${maxRounds}) {
            break
          }
          // Waiting for end events counts as a change, as page logic runs on them.
          if (endEventsPending) {
            changed = true
          }
          for (const animation of running) {
            try {
              animation.finish()
              changed = true
            } catch {
              unfinishable.add(animation)
            }
          }
          rounds += 1
        }
        if (!(await framesPassed(1))) {
          return timedOut
        }
      }
      // The last check walked the roots with no frame since. Parking and pinning add no element. Page logic can run on
      // the finished and ready promises a cancel() rejects before media are frozen, but freezing queries the elements of
      // each root afresh. So they share its roots rather than walk every element again.
      const parked = park(animationsOf(roots))
      const pinned = pin(animationsOf(roots), parked)
      return { changed: changed || parked.size > 0 || pinned > 0, roots }
    }
    try {
      const ended = await endAnimations({ afterMedia: false })
      if (ended === timedOut) {
        return { outcome: 'timed-out', step: 'animations' }
      }
      const frozen = await Promise.race([Promise.all(freezeMedia(ended.roots)), deadline])
      if (frozen === timedOut) {
        return { outcome: 'timed-out', step: 'media' }
      }
      const mediaChanged = frozen.includes(true)
      // Freezing media fires events, such as a video's pause and seeked or a replaced GIF's load, whose page logic can
      // start animations. A frame lets it run, then the animations are brought to their end once more, only once. What
      // that changes adds nothing to changed, which media already made true.
      if (mediaChanged) {
        const endedAgain = (await framesPassed(1)) && (await endAnimations({ afterMedia: true })) !== timedOut
        if (!endedAgain) {
          return { outcome: 'timed-out', step: 'animations' }
        }
      }
      const changed = ended.changed || mediaChanged
      if (changed && !(await framesPassed(2))) {
        return { outcome: 'timed-out', step: mediaChanged ? 'media' : 'animations' }
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
       * Whether it changed anything that was moving: an animation, a video, an SVG's SMIL animation or a GIF. Waiting
       * for the end events of animations the page finished counts too, as page logic ran on them. Images that came
       * into view then may need loading; a replaced GIF is already decoded.
       */
      changed: boolean
    }
  | {
      /**
       * The time limit passed while it waited for a frame or for media.
       */
      outcome: 'timed-out'
      /**
       * What it was doing: finishing the page's animations, or putting its media on their first frame. After media
       * changed, the frame that lets media events run and the settling after it count toward animations, and the last
       * frames toward media. When media changed nothing, the last frames count toward animations.
       */
      step: 'animations' | 'media'
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

  if (answer.outcome === 'timed-out' && (answer.step === 'animations' || answer.step === 'media')) {
    return { outcome: 'timed-out', step: answer.step }
  }

  if (answer.outcome === 'script-missing') {
    return { outcome: 'script-missing' }
  }

  throw new Error(`The end state in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`)
}
