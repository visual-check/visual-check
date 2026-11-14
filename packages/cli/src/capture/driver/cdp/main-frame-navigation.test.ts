import { describe, expect, it } from 'vitest'
import { PageNavigatedAwayError } from '../driver.js'
import type { CdpEvent } from './cdp-connection.js'
import { childFrame, mainFrame } from './fake-browser.fixture.js'
import { MainFrameNavigation } from './main-frame-navigation.js'

/**
 * The URL the navigation goes to.
 */
const url = 'http://storybook:6006/iframe.html?id=button--primary&viewMode=story'

/**
 * The page's target id, which is also its main frame's id.
 */
const targetId = 'target-1'

/**
 * A `Page.frameNavigated` event for this frame.
 */
function commit(frame: Record<string, unknown>): CdpEvent {
  return { method: 'Page.frameNavigated', params: { frame }, sessionId: 'session-1' }
}

/**
 * A `Page.loadEventFired` event.
 */
function load(): CdpEvent {
  return { method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'session-1' }
}

/**
 * A `Page.frameRequestedNavigation` event: the page asks to navigate this frame to `to`, with this disposition.
 */
function requested(frameId: string, to: string, disposition: string): CdpEvent {
  return {
    method: 'Page.frameRequestedNavigation',
    params: { frameId, reason: 'scriptInitiated', url: to, disposition },
    sessionId: 'session-1',
  }
}

/**
 * Starts following a navigation to `url` in the main frame, with these earlier loaders, ignoring its load.
 */
function navigate(earlierLoaderIds: string[] = []): MainFrameNavigation {
  return new MainFrameNavigation(url, targetId, new Set(earlierLoaderIds), () => undefined)
}

/**
 * Says whether the promise has resolved, rejected, or is still pending, once pending callbacks have run.
 */
async function stateOf(promise: Promise<unknown>): Promise<'resolved' | 'rejected' | 'pending'> {
  let state: 'resolved' | 'rejected' | 'pending' = 'pending'

  promise.then(
    () => {
      state = 'resolved'
    },
    () => {
      state = 'rejected'
    },
  )
  await new Promise((resolve) => setImmediate(resolve))

  return state
}

describe('MainFrameNavigation', () => {
  it('resolves on the load event once its document has committed, with the commit held until the answer', async () => {
    const navigation = navigate()

    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    expect(navigation.committed).toBe(false)
    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    expect(navigation.committed).toBe(true)
    expect(await stateOf(navigation.done)).toBe('pending')
    navigation.observe(load())
    expect(await stateOf(navigation.done)).toBe('resolved')
  })

  it('calls onLoad once, the moment its document loads, with no later events', () => {
    const loads: (readonly CdpEvent[])[] = []
    const navigation = new MainFrameNavigation(url, targetId, new Set(), (later) => loads.push(later))

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(load())
    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    expect(loads).toEqual([])
    navigation.observe(load())
    expect(loads).toEqual([[]])
    navigation.observe(load())
    expect(loads).toEqual([[]])
  })

  it('hands the events held after the load event to onLoad, and resolves though one commits another document', async () => {
    const loads: (readonly CdpEvent[])[] = []
    const navigation = new MainFrameNavigation(url, targetId, new Set(), (later) => loads.push(later))
    const elsewhere = commit(mainFrame(targetId, 'http://storybook:6006/categories/burgers', 'loader-other'))
    const stopped: CdpEvent = {
      method: 'Page.frameStoppedLoading',
      params: { frameId: targetId },
      sessionId: 'session-1',
    }

    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    navigation.observe(elsewhere)
    navigation.observe(stopped)
    expect(loads).toEqual([])
    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    expect(loads).toEqual([[elsewhere, stopped]])
    await expect(navigation.done).resolves.toBeUndefined()
  })

  it('never calls onLoad once it has failed', async () => {
    let loaded = false
    const navigation = new MainFrameNavigation(url, targetId, new Set(), () => {
      loaded = true
    })
    const failure = expect(navigation.done).rejects.toMatchObject({ name: 'PageNavigatedAwayError' })

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(requested(targetId, 'http://storybook:6006/categories/burgers', 'currentTab'))
    navigation.observe(load())
    await failure
    expect(loaded).toBe(false)
  })

  it('never loads once stopped, though a late answer reveals that its document loaded', async () => {
    let loaded = false
    const navigation = new MainFrameNavigation(url, targetId, new Set(), () => {
      loaded = true
    })

    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    navigation.stop()
    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    expect(loaded).toBe(false)
    expect(await stateOf(navigation.done)).toBe('pending')
  })

  it('resolves when the commit and the load event come after the answer', async () => {
    const navigation = navigate()

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    await expect(navigation.done).resolves.toBeUndefined()
  })

  it('resolves when the commit and the load event both come before the answer', async () => {
    const navigation = navigate()

    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    await expect(navigation.done).resolves.toBeUndefined()
  })

  it('follows a server redirect, which commits another URL with the same loader', async () => {
    const navigation = navigate()

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(commit(mainFrame(targetId, 'http://storybook:6006/iframe?id=button--primary', 'loader-1')))
    navigation.observe(load())
    await expect(navigation.done).resolves.toBeUndefined()
  })

  it('ignores a load event from before its document commits', async () => {
    const navigation = navigate()

    navigation.observe(load())
    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(load())
    expect(await stateOf(navigation.done)).toBe('pending')
    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    expect(await stateOf(navigation.done)).toBe('resolved')
  })

  it("fails with the browser's error text, though an error page commits", async () => {
    const navigation = navigate()

    navigation.observe(
      commit({ ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-1'), unreachableUrl: url }),
    )
    navigation.answer({ frameId: targetId, loaderId: 'loader-1', errorText: 'net::ERR_CONNECTION_REFUSED' })
    navigation.observe(load())
    await expect(navigation.done).rejects.toThrow(`The page couldn't load ${url}: net::ERR_CONNECTION_REFUSED`)
  })

  it('fails when the answer names no loader', async () => {
    const navigation = navigate()

    navigation.answer({ frameId: targetId })
    await expect(navigation.done).rejects.toThrow("The browser's answer to Page.navigate has no loaderId.")
  })

  it('fails with the error Page.navigate failed with', async () => {
    const navigation = navigate()
    const error = new Error('CDP Page.navigate failed: Cannot navigate to invalid URL')

    navigation.fail(error)
    await expect(navigation.done).rejects.toBe(error)
  })

  it('fails at once, before any answer, when the page starts a navigation of its main frame', async () => {
    const navigation = navigate()

    navigation.observe(requested(targetId, 'http://storybook:6006/categories/burgers', 'currentTab'))

    const error = await navigation.done.catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PageNavigatedAwayError)
    expect(error).toMatchObject({
      url: 'http://storybook:6006/categories/burgers',
      message: `The page navigated to http://storybook:6006/categories/burgers before ${url} loaded.`,
    })
  })

  it.each([
    ['a child frame', 'child-frame', 'currentTab'],
    ['a new tab', targetId, 'newTab'],
    ['a new window', targetId, 'newWindow'],
    ['a download', targetId, 'download'],
  ])('ignores a navigation the page starts in %s', async (_where, frameId, disposition) => {
    const navigation = navigate()

    navigation.observe(requested(frameId, 'http://elsewhere/', disposition))
    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    await expect(navigation.done).resolves.toBeUndefined()
  })

  it.each([
    ['before', true],
    ['after', false],
  ])('fails, naming the URL, when another loader commits the main frame %s the answer', async (_when, commitFirst) => {
    const navigation = navigate()
    const elsewhere = commit(mainFrame(targetId, 'http://storybook:6006/categories/burgers#top', 'loader-other'))

    if (commitFirst) {
      navigation.observe(elsewhere)
      expect(await stateOf(navigation.done)).toBe('pending')
    }

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })

    if (!commitFirst) {
      navigation.observe(elsewhere)
    }

    await expect(navigation.done).rejects.toMatchObject({
      name: 'PageNavigatedAwayError',
      url: 'http://storybook:6006/categories/burgers#top',
      message: `The page navigated to http://storybook:6006/categories/burgers#top before ${url} loaded.`,
    })
  })

  it('names the URL an error page stands for when it overtakes the navigation', async () => {
    const navigation = navigate()

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(
      commit({
        ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-other'),
        unreachableUrl: 'http://gone/',
      }),
    )
    await expect(navigation.done).rejects.toMatchObject({ url: 'http://gone/' })
  })

  it.each([
    ['before', true],
    ['after', false],
  ])("ignores an earlier navigation's late commit %s the answer", async (_when, commitFirst) => {
    const navigation = navigate(['loader-0'])
    const late = commit({
      ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-0'),
      unreachableUrl: 'http://127.0.0.1:1/x',
    })

    if (commitFirst) {
      navigation.observe(late)
    }

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })

    if (!commitFirst) {
      navigation.observe(late)
    }

    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    await expect(navigation.done).resolves.toBeUndefined()
  })

  it.each([
    ['a child frame', childFrame(targetId, 'http://elsewhere/')],
    ['a frame of another target', mainFrame('target-other', 'http://elsewhere/', 'loader-other')],
  ])("ignores %s's commit", async (_which, frame) => {
    const navigation = navigate()

    navigation.answer({ frameId: targetId, loaderId: 'loader-1' })
    navigation.observe(commit(frame))
    navigation.observe(commit(mainFrame(targetId, url, 'loader-1')))
    navigation.observe(load())
    await expect(navigation.done).resolves.toBeUndefined()
  })
})
