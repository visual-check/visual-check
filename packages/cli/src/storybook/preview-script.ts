import { optionsEncoderSource } from './options-encoding.js'

/**
 * The non-enumerable global the adapter's page script keeps its state under, in every document of a page.
 */
export const stateGlobal = '__visualCheckStorybook'

/**
 * The global Storybook's preview sets its channel as.
 */
const channelGlobal = '__STORYBOOK_ADDONS_CHANNEL__'

/**
 * The global Storybook's preview sets itself as.
 */
const previewGlobal = '__STORYBOOK_PREVIEW__'

/**
 * The global Storybook's preview keeps `storybook/test` under, in Storybook 9.1 and later.
 */
const testModuleGlobal = '__STORYBOOK_MODULE_TEST__'

/**
 * A function the adapter's script keeps in the page, for an expression to call.
 */
type StateFunction = 'waitForStory' | 'readOptions' | 'runWait'

/**
 * A value an expression embeds as JSON. It leaves out `undefined`, symbols and bigints, which JSON can't carry.
 */
type Embeddable = string | number | boolean | null | object

/**
 * The class Storybook puts on the body of the story's page while it shows its error display.
 */
const errorDisplayClass = 'sb-show-errordisplay'

/**
 * What an error event's payload is: one error as `{ name, message }`, a list of them, or what the error display shows
 * as `{ title, description }`.
 */
type ErrorPayload = 'error' | 'errors' | 'display'

/**
 * How visual-check reads one of Storybook's error events.
 */
interface ErrorRule {
  /**
   * The event's name.
   */
  event: string
  /**
   * What the event's payload is, so the page can describe it.
   */
  payload: ErrorPayload
  /**
   * What the story's wait comes to when the event came.
   */
  outcome: 'play-threw' | 'errored'
  /**
   * Says what went wrong, from the description of the event's payload, which can be empty.
   */
  message: (text: string) => string
}

/**
 * Storybook's channel events that say something went wrong in the story, and what each makes of a finished story, in
 * the order they're checked: the first rule with an event the page recorded wins, with the text of the first such
 * event. The page records exactly these events. None carries a story ID, and none needs one: each capture loads one
 * story in a fresh document, so every event in it belongs to that story.
 */
const errorRules = [
  {
    event: 'playFunctionThrewException',
    payload: 'error',
    outcome: 'play-threw',
    message: (text) => withDetail("The story's play function threw", ' ', text, 'an error'),
  },
  {
    event: 'unhandledErrorsWhilePlaying',
    payload: 'errors',
    outcome: 'play-threw',
    message: (text) => withDetail("The story's play function left unhandled errors", ': ', text),
  },
  {
    event: 'storyThrewException',
    payload: 'error',
    outcome: 'errored',
    message: (text) => withDetail('The story threw', ' ', text, 'an error'),
  },
  {
    event: 'storyErrored',
    payload: 'display',
    outcome: 'errored',
    message: (text) => withDetail('Storybook showed its error display', ': ', text),
  },
] as const satisfies readonly ErrorRule[]

/**
 * The name of one of Storybook's error events.
 */
type ErrorEvent = (typeof errorRules)[number]['event']

/**
 * What each error event's payload is, by the event's name, for the page.
 */
const errorPayloads = Object.fromEntries(errorRules.map((rule) => [rule.event, rule.payload]))

/**
 * How many error events the page keeps: the first ones.
 */
const keptErrors = 10

/**
 * How many characters the page keeps of each error event's description.
 */
const keptCharacters = 500

/**
 * Matches the text of the two stylesheets Storybook 9.1 and 10 append to the document on the test path while a story
 * completes: the one that disables animations for a moment, and the one that pauses them for good. Both are a single
 * rule for `*, *:before, *:after`, matched in full so a stylesheet of the page's own never matches. It checks the text,
 * not the version: Storybook 11 adds no stylesheet, so nothing matches there.
 */
const pauseSheetPattern = new RegExp(
  [
    String.raw`^\s*\*,\s*\*:before,\s*\*:after\s*\{\s*(?:`,
    String.raw`animation:\s*none\s*!important;`,
    String.raw`|animation-delay:\s*0s\s*!important;`,
    String.raw`\s*animation-direction:\s*(?:reverse|normal)\s*!important;`,
    String.raw`\s*animation-play-state:\s*paused\s*!important;`,
    String.raw`\s*transition:\s*none\s*!important;`,
    String.raw`)\s*\}\s*$`,
  ].join(''),
)

/**
 * The script that runs at the start of every document of a page, as part of the page script. Its one style change is
 * to empty the pause stylesheets Storybook 9.1 and 10 add on the test path, and it reads the document only once the
 * story finished. It does only this, keeping its state under one non-enumerable, frozen global:
 *
 * - hooks Storybook's channel when the preview sets `__STORYBOOK_ADDONS_CHANNEL__`, to note each `storyFinished` with
 *   its story ID and status, each story's last render step, and when its `completing` and `completed` steps came;
 * - records Storybook's error events in the order they come: the first 10, each as `event` and one line of `text` of
 *   up to 500 characters. An error is described as `name: message`, or whichever of the two isn't empty, what the
 *   error display shows as `title: description` the same way, and a list of errors joined by `; `. Any other payload
 *   is described as text;
 * - hooks Storybook's preview when it sets `__STORYBOOK_PREVIEW__`, to keep it and note that it started, and calls its
 *   `ready()` just after, to note when it becomes ready, or why it failed, on one line of up to 500 characters as an
 *   error is described. A preview that replaces another is waited for on its own;
 * - wraps `Node.prototype.appendChild` to empty the text of a `<style>` element that matches Storybook 9.1 and 10's
 *   pause or disable stylesheet just before it's appended, so the story keeps running as in plain Storybook. It leaves
 *   every other node and style alone, and passes `this`, the arguments, the result and any error of the original
 *   through. Where the page has no `Node` or `HTMLStyleElement` it does nothing;
 * - gives `waitForStory`, which the story wait expression calls;
 * - gives `readOptions`, which the options read expression calls with stories files and a time limit. It waits for
 *   the latest preview to become ready or fail, then calls its `loadStory` for every story of every file: all files at
 *   once, each within its own time limit, counted from then. A file that fails or runs out of time never stops
 *   another. It answers with each story's `parameters.visualCheck`, encoded by `optionsEncoderSource` so it crosses
 *   as JSON, and the own enumerable string keys of its `storyGlobals`, the globals it or its meta pins, none when they
 *   can't be read; or with why each other file didn't load, on one line. It answers too with the globals the
 *   Storybook declares: the string names its story store's `userGlobals.allowedGlobalNames` holds, or `null` when
 *   that can't be read or isn't a `Set`. It never calls `extract()`, never loads a docs entry, and keeps nothing
 *   between reads;
 * - gives `runWait`, which the wait hook expression calls with a story ID and a time limit. It takes the latest
 *   preview's `currentRender`, and answers `no-render` unless that's a render of the story with its `story` and a
 *   `storyContext()`. When the story's merged `parameters.visualCheck.wait` is a function, it calls it once with a
 *   context of only: what the render's `storyContext()` gives, then the render's `viewMode` and `canvasElement`, then
 *   `canvas` as `within(canvasElement)` when Storybook's `__STORYBOOK_MODULE_TEST__` has `within`, then `userEvent`
 *   when it has `userEvent.setup` and the page has `navigator.clipboard`, as Storybook does for `play`. `userEvent` is
 *   set up by `userEvent.setup()` when the hook first reads it, once, and the page's own `navigator.clipboard`, which
 *   `setup()` stubs, is put back right after; a `setup()` that throws throws inside the hook. Unlike `play`, the hook
 *   gets no `loaded`, `step`, `mount` or `abortSignal`. It waits until the hook settles or the time limit passes. A
 *   throw or rejection of the hook, or of a thenable it gives, answers `threw`. A failure to read the hook or build
 *   its context answers `context-failed`, without calling the hook. Each is described on one line of up to 500
 *   characters, as an error is. It never throws or rejects, and a rejection after the time limit is handled too.
 *
 * It keeps the browser's own `setTimeout`, `clearTimeout` and `performance.now`, so a story that fakes or replaces
 * timers stalls none of the story wait, the options read and the wait hook. A value the page sets as the channel or
 * the preview never makes Storybook's own assignment throw, and the page reads back what it set.
 *
 * @public
 */
export const storybookPageScript = `(() => {
  if (Object.prototype.hasOwnProperty.call(globalThis, '${stateGlobal}')) {
    return
  }

  const setTimer = globalThis.setTimeout.bind(globalThis)
  const clearTimer = globalThis.clearTimeout.bind(globalThis)
  const now = performance.now.bind(performance)
  const errorPayloads = ${JSON.stringify(errorPayloads)}
  const finished = new Map()
  const lastSteps = new Map()
  const completingTimes = new Map()
  const completedTimes = new Map()
  const errors = []
  const waiters = new Set()
  const previewWaiters = new Set()
  const channels = new WeakSet()
  const previews = new WeakMap()
  let latestPreview

  const readSafely = (read) => {
    try {
      return read()
    } catch {
      return undefined
    }
  }

  // Describing error payloads: one line of plain fields, never throwing.

  const textOf = (value) => {
    try {
      return String(value)
    } catch {
      return '[unprintable]'
    }
  }

  const describePair = (value, label, detail) => {
    if (typeof value !== 'object' || value === null) {
      return textOf(value)
    }
    const labelText = value[label]
    const detailText = value[detail]
    if (typeof labelText !== 'string' && typeof detailText !== 'string') {
      return textOf(value)
    }
    return [labelText, detailText].filter((text) => typeof text === 'string' && text !== '').join(': ')
  }

  const describe = (event, value) => {
    const payload = errorPayloads[event]
    if (payload === 'display') {
      return describePair(value, 'title', 'description')
    }
    if (payload === 'errors' && Array.isArray(value)) {
      return value
        .map((item) => describePair(item, 'name', 'message'))
        .filter((text) => text !== '')
        .join('; ')
    }
    return describePair(value, 'name', 'message')
  }

  const oneLine = (text) => text.replace(/\\s+/g, ' ').trim().slice(0, ${keptCharacters})

  const describeError = (value) => {
    try {
      return oneLine(describePair(value, 'name', 'message'))
    } catch {
      return oneLine(textOf(value))
    }
  }

  // Recording what Storybook sends on its channel.

  const recordError = (event, value) => {
    try {
      if (errors.length >= ${keptErrors}) {
        return
      }
      let text
      try {
        text = describe(event, value)
      } catch {
        text = textOf(value)
      }
      errors.push({ event, text: oneLine(text) })
    } catch {}
  }

  const noteStep = (change) => {
    try {
      if (typeof change !== 'object' || change === null) {
        return
      }
      const storyId = change.storyId
      const step = change.newPhase
      if (typeof storyId !== 'string' || typeof step !== 'string') {
        return
      }
      lastSteps.set(storyId, step)
      if (step === 'completing') {
        completingTimes.set(storyId, now())
        completedTimes.delete(storyId)
      }
      if (step === 'completed') {
        completedTimes.set(storyId, now())
      }
    } catch {}
  }

  const finish = (payload) => {
    try {
      if (typeof payload !== 'object' || payload === null || typeof payload.storyId !== 'string') {
        return
      }
      finished.set(payload.storyId, typeof payload.status === 'string' ? payload.status : 'unknown')
      for (const waiter of [...waiters]) {
        waiter(payload.storyId)
      }
    } catch {}
  }

  // Hooking the globals Storybook's preview sets, without ever throwing into its assignments.

  const listen = (channel) => {
    try {
      if (typeof channel !== 'object' || channel === null || channels.has(channel) || typeof channel.on !== 'function') {
        return
      }
      channels.add(channel)
      channel.on('storyFinished', finish)
      channel.on('storyRenderPhaseChanged', noteStep)
      for (const event of Object.keys(errorPayloads)) {
        channel.on(event, (value) => recordError(event, value))
      }
    } catch {}
  }

  const notePreview = () => {
    try {
      for (const waiter of [...previewWaiters]) {
        waiter()
      }
    } catch {}
  }

  const trackPreview = (preview) => {
    if ((typeof preview !== 'object' && typeof preview !== 'function') || preview === null) {
      return
    }
    const known = previews.get(preview)
    if (known !== undefined) {
      latestPreview = known
      return
    }
    const state = { preview, ready: true, failure: undefined }
    previews.set(preview, state)
    latestPreview = state
    if (typeof preview.ready !== 'function') {
      return
    }
    state.ready = false
    Promise.resolve()
      .then(() => preview.ready())
      .then(
        () => {
          state.ready = true
        },
        (error) => {
          state.failure = describeError(error)
        },
      )
      .then(notePreview)
  }

  const watchPreview = (preview) => {
    try {
      trackPreview(preview)
    } catch {}
    notePreview()
  }

  const hook = (name, watch) => {
    let current = globalThis[name]
    watch(current)
    try {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (value) => {
          current = value
          watch(value)
        },
      })
    } catch {}
  }

  hook('${channelGlobal}', listen)
  hook('${previewGlobal}', watchPreview)

  // Emptying the pause stylesheets Storybook 9.1 and 10 add on the test path, by what they say.

  if (typeof Node === 'function' && typeof HTMLStyleElement === 'function') {
    const pauseSheet = ${String(pauseSheetPattern)}
    const apply = Reflect.apply
    const StyleElement = HTMLStyleElement

    try {
      const originalAppendChild = Node.prototype.appendChild

      Node.prototype.appendChild = function appendChild(node) {
        try {
          if (node instanceof StyleElement && pauseSheet.test(node.textContent)) {
            node.textContent = ''
          }
        } catch {}
        return apply(originalAppendChild, this, arguments)
      }
    } catch {}
  }

  // The wait: the page's answer once the story finished, or where it was when the time ran out.

  const showsErrorDisplay = () => {
    try {
      const body = document.body
      return typeof body === 'object' && body !== null && body.classList.contains('${errorDisplayClass}') === true
    } catch {
      return false
    }
  }

  const finishedAnswer = (storyId) => ({
    outcome: 'finished',
    status: finished.get(storyId),
    errorDisplay: showsErrorDisplay(),
    errors: errors.map((error) => ({ ...error })),
    completingMs:
      completingTimes.has(storyId) && completedTimes.has(storyId)
        ? completedTimes.get(storyId) - completingTimes.get(storyId)
        : null,
  })

  const waitingStep = () => {
    if (latestPreview === undefined) {
      return 'preview-start'
    }
    return latestPreview.ready ? 'story' : 'preview-ready'
  }

  const waitForStory = (storyId, timeoutMs) => new Promise((resolve) => {
    if (finished.has(storyId)) {
      resolve(finishedAnswer(storyId))
      return
    }
    const waiter = (finishedId) => {
      if (finishedId === storyId) {
        waiters.delete(waiter)
        clearTimer(timer)
        resolve(finishedAnswer(storyId))
      }
    }
    const timer = setTimer(() => {
      waiters.delete(waiter)
      resolve({
        outcome: 'timed-out',
        step: waitingStep(),
        lastRenderStep: lastSteps.has(storyId) ? lastSteps.get(storyId) : null,
      })
    }, timeoutMs)
    waiters.add(waiter)
  })

  // The options read: each story's options, through the latest preview's loadStory, encoded so they cross as JSON, with
  // the globals the Storybook declares and the globals each story pins.

  const encodeValue = ${optionsEncoderSource}

  const encodeOptions = (story) => {
    let options
    try {
      options = story?.parameters?.visualCheck
    } catch {
      return { kind: 'instance', name: 'Unreadable' }
    }
    return encodeValue(options)
  }

  const keysOf = (value) => (typeof value === 'object' && value !== null ? Object.keys(value) : undefined)

  // Set.prototype.values throws for anything but a Set, so a look-alike never counts as one.
  const allowedNamesOf = (store) =>
    readSafely(() =>
      Array.from(Set.prototype.values.call(store.userGlobals.allowedGlobalNames)).filter(
        (name) => typeof name === 'string',
      ),
    )

  const declaredGlobalsOf = (preview) => allowedNamesOf(readSafely(() => preview.storyStoreValue)) ?? null

  const pinnedGlobalsOf = (story) => readSafely(() => keysOf(story.storyGlobals)) ?? []

  const settledAnswer = () => {
    const latest = latestPreview
    if (latest !== undefined && latest.failure !== undefined) {
      return { outcome: 'preview-failed', message: latest.failure }
    }
    if (latest !== undefined && latest.ready) {
      return { outcome: 'ready', preview: latest.preview }
    }
    return undefined
  }

  const settledPreview = (timeoutMs) => new Promise((resolve) => {
    const settle = (answer) => {
      previewWaiters.delete(waiter)
      clearTimer(timer)
      resolve(answer)
    }
    const waiter = () => {
      const answer = settledAnswer()
      if (answer !== undefined) {
        settle(answer)
      }
    }
    const timer = setTimer(() => {
      settle({ outcome: 'timed-out', step: latestPreview === undefined ? 'preview-start' : 'preview-ready' })
    }, timeoutMs)
    previewWaiters.add(waiter)
    waiter()
  })

  const canLoadStories = (preview) => {
    try {
      return typeof preview.loadStory === 'function'
    } catch {
      return false
    }
  }

  const loadStories = (preview, storyIds) =>
    Promise.all(
      storyIds.map(
        (storyId) =>
          new Promise((resolve) => {
            resolve(preview.loadStory({ storyId }))
          }),
      ),
    )

  const readFile = (preview, file, timeoutMs) => new Promise((resolve) => {
    const { importPath, storyIds } = file
    const timer = setTimer(() => {
      resolve({ importPath, outcome: 'timed-out' })
    }, timeoutMs)
    loadStories(preview, storyIds).then(
      (stories) => {
        clearTimer(timer)
        resolve({
          importPath,
          outcome: 'loaded',
          stories: storyIds.map((id, index) => ({
            id,
            options: encodeOptions(stories[index]),
            pinnedGlobals: pinnedGlobalsOf(stories[index]),
          })),
        })
      },
      (error) => {
        clearTimer(timer)
        resolve({ importPath, outcome: 'failed', message: describeError(error) })
      },
    )
  })

  const readOptions = async (files, timeoutMs) => {
    const settled = await settledPreview(timeoutMs)
    if (settled.outcome !== 'ready') {
      return settled
    }
    if (!canLoadStories(settled.preview)) {
      return { outcome: 'unsupported' }
    }
    return {
      outcome: 'read',
      declaredGlobals: declaredGlobalsOf(settled.preview),
      files: await Promise.all(files.map((file) => readFile(settled.preview, file, timeoutMs))),
    }
  }

  // The wait hook: the story's parameters.visualCheck.wait, run on the render on screen with the story's context.

  const renderOf = (storyId) => {
    try {
      const render = latestPreview?.preview.currentRender
      if (typeof render !== 'object' || render === null || render.id !== storyId) {
        return undefined
      }
      const story = render.story
      if (typeof story !== 'object' || story === null || typeof render.storyContext !== 'function') {
        return undefined
      }
      return render
    } catch {
      return undefined
    }
  }

  const runHook = (hook, context, timeoutMs) => new Promise((resolve) => {
    const timer = setTimer(() => {
      resolve({ outcome: 'timed-out' })
    }, timeoutMs)
    const settle = (answer) => {
      clearTimer(timer)
      resolve(answer)
    }
    new Promise((resolveHook) => {
      resolveHook(hook(context))
    }).then(
      () => settle({ outcome: 'done' }),
      (error) => settle({ outcome: 'threw', text: describeError(error) }),
    )
  })

  const testHelpers = () => {
    const testModule = readSafely(() => globalThis.${testModuleGlobal})
    const within = readSafely(() => testModule.within)
    const userEvent = readSafely(() => testModule.userEvent)
    return {
      within: typeof within === 'function' ? within : undefined,
      userEvent: readSafely(() => typeof userEvent.setup === 'function') === true ? userEvent : undefined,
    }
  }

  // userEvent.setup() stubs navigator.clipboard. As Storybook does for play, the page sets userEvent up only where the
  // page has a clipboard, and puts the real one back right after.
  const setUpUser = (userEvent, pageNavigator, clipboard) => {
    try {
      return userEvent.setup()
    } finally {
      try {
        Object.defineProperty(pageNavigator, 'clipboard', { configurable: true, get: () => clipboard })
      } catch {}
    }
  }

  const defineUserEvent = (context, userEvent) => {
    const pageNavigator = readSafely(() => globalThis.navigator)
    const clipboard = readSafely(() => pageNavigator.clipboard)
    if (!clipboard) {
      return
    }
    Object.defineProperty(context, 'userEvent', {
      configurable: true,
      enumerable: true,
      get: () => {
        const user = setUpUser(userEvent, pageNavigator, clipboard)
        Object.defineProperty(context, 'userEvent', { configurable: true, enumerable: true, writable: true, value: user })
        return user
      },
    })
  }

  const contextOf = (render) => {
    const context = { ...render.storyContext(), viewMode: render.viewMode, canvasElement: render.canvasElement }
    const { within, userEvent } = testHelpers()
    if (within !== undefined) {
      context.canvas = within(context.canvasElement)
    }
    if (userEvent !== undefined) {
      defineUserEvent(context, userEvent)
    }
    return context
  }

  const runWait = async (storyId, timeoutMs) => {
    const render = renderOf(storyId)
    if (render === undefined) {
      return { outcome: 'no-render' }
    }
    let hook
    let context
    try {
      hook = render.story.parameters?.visualCheck?.wait
      if (typeof hook !== 'function') {
        return { outcome: 'none' }
      }
      context = contextOf(render)
    } catch (error) {
      return { outcome: 'context-failed', text: describeError(error) }
    }
    return await runHook(hook, context, timeoutMs)
  }

  Object.defineProperty(globalThis, '${stateGlobal}', { value: Object.freeze({ waitForStory, readOptions, runWait }) })
})()`

/**
 * One of Storybook's error events, as the page recorded it.
 */
interface RecordedError {
  /**
   * The event's name.
   */
  event: ErrorEvent
  /**
   * One line describing the event's payload.
   */
  text: string
}

/**
 * What the story wait in the page gave once Storybook reported the story finished, as visual-check checked it.
 */
interface FinishedAnswer {
  /**
   * The status Storybook reported, such as `success` or `error`, or `unknown` when it wasn't text.
   */
  status: string
  /**
   * Whether Storybook showed its error display as the story finished.
   */
  errorDisplay: boolean
  /**
   * Storybook's error events, in the order they came.
   */
  errors: RecordedError[]
  /**
   * The time between the story's `completing` and `completed` render steps, in ms, or `null` when either didn't come.
   */
  completingMs: number | null
}

/**
 * Where the story was when the wait timed out: Storybook's preview hadn't started, or had started and wasn't ready, or
 * was ready and the story hadn't finished.
 */
type WaitStep = 'preview-start' | 'preview-ready' | 'story'

/**
 * What the story wait found in the page, in visual-check's own terms.
 *
 * @public
 */
export type StoryWait =
  | {
      /**
       * The story finished well.
       */
      outcome: 'finished'
      /**
       * The time between the story's `completing` and `completed` render steps, in ms, when both came.
       */
      completingMs: number | undefined
    }
  | {
      /**
       * The story's `play` function threw or left unhandled errors.
       */
      outcome: 'play-threw'
      /**
       * One line for people saying what went wrong.
       */
      message: string
    }
  | {
      /**
       * The story threw, Storybook showed its error display, or Storybook reported a status other than success.
       */
      outcome: 'errored'
      /**
       * One line for people saying what went wrong.
       */
      message: string
    }
  | {
      /**
       * The time limit passed before the story finished.
       */
      outcome: 'timed-out'
      /**
       * Where the story was when the time ran out.
       */
      step: WaitStep
      /**
       * The last render step Storybook reported for the story, if any.
       */
      lastRenderStep: string | undefined
    }
  | {
      /**
       * The adapter's script hadn't run in the page, so there was nothing to wait with.
       */
      outcome: 'script-missing'
    }

/**
 * Builds the expression that waits in the page until Storybook reports this story finished, or `timeoutMs` passes,
 * rounded up to whole ms. Its value is the page's answer, which `readStoryWait` reads. A `storyFinished` for another
 * story doesn't count, and one that came before the wait started does.
 *
 * @public
 */
export function storyWaitExpression(storyId: string, timeoutMs: number): string {
  return stateCallExpression('waitForStory', [storyId], timeoutMs)
}

/**
 * Builds the expression that calls one of the functions the adapter's script keeps in the page, with `args`, each
 * embedded as JSON, and then `timeoutMs`, rounded up to whole ms. Its value is the function's answer, or
 * `{ outcome: 'script-missing' }` when the adapter's script hadn't run in the page.
 */
export function stateCallExpression(method: StateFunction, args: readonly Embeddable[], timeoutMs: number): string {
  const limit = Math.max(0, Math.ceil(timeoutMs))
  const embedded = [...args.map((arg) => JSON.stringify(arg)), limit].join(', ')

  return `(async () => {
  const state = globalThis.${stateGlobal}
  return state === undefined ? { outcome: 'script-missing' } : state.${method}(${embedded})
})()`
}

/**
 * Joins the lead of a message and the detail, ending with one period. Without detail, it ends with `fallback`, if any.
 */
export function withDetail(lead: string, separator: string, detail: string, fallback?: string): string {
  if (detail === '') {
    return fallback === undefined ? `${lead}.` : `${lead} ${fallback}.`
  }

  return `${lead}${separator}${detail.endsWith('.') ? detail : `${detail}.`}`
}

/**
 * Says what a finished story comes to: an error event, the error display or a status other than success makes it
 * broken, in that order.
 */
function classifyFinished(answer: FinishedAnswer): StoryWait {
  for (const rule of errorRules) {
    const error = answer.errors.find((recorded) => recorded.event === rule.event)

    if (error !== undefined) {
      return { outcome: rule.outcome, message: rule.message(error.text) }
    }
  }

  if (answer.errorDisplay) {
    return { outcome: 'errored', message: 'Storybook showed its error display.' }
  }

  if (answer.status !== 'success') {
    return {
      outcome: 'errored',
      message: `Storybook reported the story finished with status ${JSON.stringify(answer.status)}, as it does when a loader, beforeEach or the render throws, or when a check such as accessibility fails.`,
    }
  }

  return { outcome: 'finished', completingMs: answer.completingMs ?? undefined }
}

/**
 * Whether a value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a value is an error event as the page records it.
 */
function isRecordedError(value: unknown): value is RecordedError {
  return isRecord(value) && errorRules.some((rule) => rule.event === value.event) && typeof value.text === 'string'
}

/**
 * Whether a value is a step the wait can time out in.
 */
function isWaitStep(value: unknown): value is WaitStep {
  return value === 'preview-start' || value === 'preview-ready' || value === 'story'
}

/**
 * Reads the value the story wait expression gave, and says what it comes to. Throws, quoting the value, when it's not
 * an answer the page gives.
 *
 * @public
 */
export function readStoryWait(value: unknown): StoryWait {
  const answer: Record<string, unknown> = isRecord(value) ? { ...value } : {}
  const { completingMs, errors, lastRenderStep } = answer

  if (
    answer.outcome === 'finished' &&
    typeof answer.status === 'string' &&
    typeof answer.errorDisplay === 'boolean' &&
    Array.isArray(errors) &&
    errors.every(isRecordedError) &&
    (completingMs === null || typeof completingMs === 'number')
  ) {
    return classifyFinished({ status: answer.status, errorDisplay: answer.errorDisplay, errors, completingMs })
  }

  if (
    answer.outcome === 'timed-out' &&
    isWaitStep(answer.step) &&
    (lastRenderStep === null || typeof lastRenderStep === 'string')
  ) {
    return { outcome: 'timed-out', step: answer.step, lastRenderStep: lastRenderStep ?? undefined }
  }

  if (answer.outcome === 'script-missing') {
    return { outcome: 'script-missing' }
  }

  throw new Error(`The Storybook wait in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`)
}
