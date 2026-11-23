import { join } from 'node:path'
import type { AddonOutcome, AddonSnapshot } from '@visual-check/cli/internal/addon-protocol'
import { describe, expect, it } from 'vitest'
import type { VisualCheckState } from '../channel-events/events.js'
import type { EngineListener } from '../engine-process/engine-process.js'
import { type CheckRelay, startCheckRelay } from './check-relay.js'

/**
 * Builds a snapshot that differs, whose images have the stem.
 */
function differingSnapshot(stem: string): AddonSnapshot {
  return {
    storybook: 'web',
    id: stem,
    kind: 'story',
    story: stem,
    importPath: './button.stories.tsx',
    mode: null,
    status: 'differs',
    reason: 'pixels',
    message: '',
    flaky: false,
    attempts: 1,
    pixels: null,
    size: null,
    details: null,
    hints: [],
    console: [],
    baseline: `.visual-check/baselines/${stem}.png`,
    images: {
      baseline: `snapshots/web/${stem}.baseline.png`,
      snapshot: `snapshots/web/${stem}.snapshot.png`,
      diff: null,
    },
  }
}

/**
 * The folder the images are in.
 */
const imagesFolder = join('/project', '.visual-check')

/**
 * Builds the outcome of a check with one snapshot.
 */
function checkedWith(stem: string): AddonOutcome {
  return {
    result: 'checked',
    storybook: 'web',
    imagesFolder,
    snapshots: [differingSnapshot(stem)],
    disabled: false,
    notices: [],
  }
}

/**
 * A check the fake engine was asked for.
 */
interface AskedCheck {
  /**
   * The request.
   */
  request: unknown
  /**
   * Takes what the check says.
   */
  listener: EngineListener
}

/**
 * A relay with a fake channel and engine, and what they got.
 */
interface RelaySetup {
  /**
   * The relay.
   */
  relay: CheckRelay
  /**
   * Every check asked for, in order.
   */
  checks: AskedCheck[]
  /**
   * The ID of every check cancelled, in order.
   */
  cancelled: string[]
  /**
   * Every event emitted to the managers, as its name and payload, in order.
   */
  emitted: [string, unknown][]
  /**
   * Gets an event from a manager or a preview.
   */
  receive: (event: string, payload?: unknown) => void
  /**
   * Gives the state in the last event emitted, which is a state.
   */
  lastState: () => VisualCheckState
  /**
   * Asks for a check of a story and ends it.
   */
  checkAs: (storyId: string, outcome: AddonOutcome) => void
}

/**
 * Starts a relay whose clicks' IDs are `1`, `2` and so on.
 */
function setUp(): RelaySetup {
  const checks: AskedCheck[] = []
  const cancelled: string[] = []
  const emitted: [string, unknown][] = []
  const listeners = new Map<string, (payload: unknown) => void>()
  let clicks = 0

  const relay = startCheckRelay({
    channel: {
      on: (event, listener) => {
        listeners.set(event, listener)
      },
      emit: (event, payload) => {
        emitted.push([event, payload])
      },
    },
    configDir: '/project/.storybook',
    address: 'http://127.0.0.1:6006',
    engine: {
      check: (request, listener) => {
        checks.push({ request, listener })
      },
      cancel: (id) => {
        cancelled.push(id)
      },
    },
    newId: () => {
      clicks += 1

      return String(clicks)
    },
  })

  const receive = (event: string, payload?: unknown): void => listeners.get(event)?.(payload)

  return {
    relay,
    checks,
    cancelled,
    emitted,
    receive,
    lastState: () => {
      const [event, payload] = emitted.at(-1) ?? []

      expect(event).toBe('visual-check/state')

      return payload as VisualCheckState
    },
    checkAs: (storyId, outcome) => {
      receive('visual-check/check', { storyId })
      checks.at(-1)?.listener.finished(outcome)
    },
  }
}

describe('startCheckRelay', () => {
  it('says nothing before it is asked', () => {
    const { checks, emitted } = setUp()

    expect(checks).toEqual([])
    expect(emitted).toEqual([])
  })

  it('checks a story of this Storybook and tells the managers of the run', () => {
    const { checks, receive, lastState } = setUp()

    receive('visual-check/check', { storyId: 'a' })

    expect(checks.map(({ request }) => request)).toEqual([
      { id: '1', storyId: 'a', configDir: '/project/.storybook', url: 'http://127.0.0.1:6006' },
    ])
    expect(lastState()).toMatchObject({ run: { id: '1', storyId: 'a', step: 'preparing' }, results: {} })
  })

  it('tells the managers of the progress as the run alone', () => {
    const { checks, emitted, receive } = setUp()

    receive('visual-check/check', { storyId: 'a' })
    checks[0]?.listener.progress({ step: 'capturing', finished: 1, total: 2 })

    expect(emitted).toHaveLength(2)
    expect(emitted[1]).toEqual([
      'visual-check/run',
      expect.objectContaining({ id: '1', step: 'capturing', finished: 1, total: 2 }),
    ])
  })

  it('ignores a check while one runs, and takes the next one after it', () => {
    const { checks, emitted, receive, lastState } = setUp()

    receive('visual-check/check', { storyId: 'a' })
    receive('visual-check/check', { storyId: 'a' })
    receive('visual-check/check', { storyId: 'b' })

    expect(checks).toHaveLength(1)
    expect(emitted).toHaveLength(1)

    checks[0]?.listener.finished(checkedWith('a'))
    receive('visual-check/check', { storyId: 'b' })

    expect(checks).toHaveLength(2)
    expect(lastState()).toMatchObject({ run: { id: '2', storyId: 'b' }, results: { a: { id: '1' } } })
  })

  it('takes a check that ends at once', () => {
    const emitted: [string, unknown][] = []
    const listeners = new Map<string, (payload: unknown) => void>()

    startCheckRelay({
      channel: {
        on: (event, listener) => {
          listeners.set(event, listener)
        },
        emit: (event, payload) => {
          emitted.push([event, payload])
        },
      },
      configDir: '/project/.storybook',
      address: 'http://127.0.0.1:6006',
      engine: {
        check: (_request, listener) =>
          listener.finished({ result: 'stopped', cause: 'run', message: 'No CLI.', notices: [] }),
        cancel: () => undefined,
      },
    })
    listeners.get('visual-check/check')?.({ storyId: 'a' })

    expect(emitted.map(([event]) => event)).toEqual(['visual-check/state', 'visual-check/state'])
    expect(emitted[1]?.[1]).toMatchObject({ run: null, results: { a: { outcome: { message: 'No CLI.' } } } })
  })

  it('gives every tab that asks the same state', () => {
    const { checkAs, emitted, receive, lastState } = setUp()

    checkAs('a', checkedWith('a'))

    const state = lastState()

    receive('visual-check/get-state')
    receive('visual-check/get-state')

    expect(emitted.slice(-2)).toEqual([
      ['visual-check/state', state],
      ['visual-check/state', state],
    ])
    expect(Object.keys(state)).toEqual(['run', 'results'])
    expect(state.results.a?.outcome).not.toHaveProperty('imagesFolder')
  })

  it('cancels the run by its ID alone, once', () => {
    const { cancelled, emitted, receive, lastState } = setUp()

    receive('visual-check/cancel', { id: '1' })
    receive('visual-check/check', { storyId: 'a' })
    receive('visual-check/cancel', { id: '2' })

    expect(cancelled).toEqual([])
    expect(emitted).toHaveLength(1)

    receive('visual-check/cancel', { id: '1' })

    expect(cancelled).toEqual(['1'])
    expect(lastState().run).toMatchObject({ id: '1', cancelling: true })
  })

  it("keeps the story's earlier result and its images when a run is cancelled", () => {
    const { relay, checkAs, lastState } = setUp()

    checkAs('a', checkedWith('a'))
    checkAs('a', { result: 'cancelled' })

    expect(lastState()).toMatchObject({ run: null, results: { a: { id: '1' } } })
    expect(relay.imageAt('1', 'snapshots/web/a.snapshot.png')).toBeDefined()
  })

  it.each(['visual-check/stale', 'storyIndexInvalidated', 'storyHotUpdated'])(
    'marks every result stale on %s, the coming one too',
    (event) => {
      const { checks, checkAs, emitted, receive, lastState } = setUp()

      receive(event)
      expect(emitted).toEqual([])

      checkAs('a', checkedWith('a'))
      expect(lastState().results.a?.stale).toBe(false)

      receive('visual-check/check', { storyId: 'b' })
      receive(event)
      expect(lastState().results.a?.stale).toBe(true)

      const count = emitted.length

      receive(event)
      expect(emitted).toHaveLength(count)

      checks[1]?.listener.finished(checkedWith('b'))
      expect(lastState().results.b?.stale).toBe(true)
    },
  )

  it('has the images a result lists, and no other', () => {
    const { relay, checkAs } = setUp()

    checkAs('a', checkedWith('a'))

    expect(relay.imageAt('1', 'snapshots/web/a.baseline.png')).toBe(
      join(imagesFolder, 'snapshots', 'web', 'a.baseline.png'),
    )
    expect(relay.imageAt('1', 'snapshots/web/a.snapshot.png')).toBe(
      join(imagesFolder, 'snapshots', 'web', 'a.snapshot.png'),
    )
    expect(relay.imageAt('1', 'diffs/web/a.png')).toBeUndefined()
    expect(relay.imageAt('1', 'snapshots/web/../web/a.baseline.png')).toBeUndefined()
    expect(relay.imageAt('2', 'snapshots/web/a.baseline.png')).toBeUndefined()
  })

  it('drops the images of a result that was replaced, whatever replaced it', () => {
    const { relay, checkAs } = setUp()

    checkAs('a', checkedWith('a'))
    checkAs('b', checkedWith('b'))
    checkAs('a', checkedWith('a'))

    expect(relay.imageAt('1', 'snapshots/web/a.baseline.png')).toBeUndefined()
    expect(relay.imageAt('2', 'snapshots/web/b.baseline.png')).toBeDefined()
    expect(relay.imageAt('3', 'snapshots/web/a.baseline.png')).toBeDefined()

    checkAs('a', { result: 'stopped', cause: 'run', message: 'No Docker.', notices: [] })

    expect(relay.imageAt('3', 'snapshots/web/a.baseline.png')).toBeUndefined()
  })

  it('drops the images of a result that went because there are too many', () => {
    const { relay, checkAs } = setUp()

    for (let click = 1; click <= 201; click += 1) {
      checkAs(`story--${click}`, checkedWith('a'))
    }

    expect(relay.imageAt('1', 'snapshots/web/a.baseline.png')).toBeUndefined()
    expect(relay.imageAt('2', 'snapshots/web/a.baseline.png')).toBeDefined()
    expect(relay.imageAt('201', 'snapshots/web/a.baseline.png')).toBeDefined()
  })

  it('clears the results and drops their images, and keeps the run', () => {
    const { relay, checks, checkAs, receive, lastState } = setUp()

    checkAs('a', checkedWith('a'))
    receive('visual-check/check', { storyId: 'b' })
    receive('visual-check/clear')

    expect(lastState()).toMatchObject({ run: { id: '2' }, results: {} })
    expect(relay.imageAt('1', 'snapshots/web/a.baseline.png')).toBeUndefined()

    checks[1]?.listener.finished(checkedWith('b'))

    expect(Object.keys(lastState().results)).toEqual(['b'])
    expect(relay.imageAt('2', 'snapshots/web/b.baseline.png')).toBeDefined()
  })

  it.each([undefined, null, 'a', 1, [], { storyId: '' }, { storyId: {} }, { id: 1 }, { id: '' }])(
    'ignores a payload that is junk: %j',
    (payload) => {
      const { checks, cancelled, emitted, receive } = setUp()

      receive('visual-check/check', payload)
      receive('visual-check/cancel', payload)

      expect(checks).toEqual([])
      expect(cancelled).toEqual([])
      expect(emitted).toEqual([])
    },
  )
})
