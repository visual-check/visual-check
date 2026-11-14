import { describe, expect, it } from 'vitest'
import { PageNavigatedAwayError, PageTimeoutError } from '../driver.js'
import { CdpError, type CdpEvent } from './cdp-connection.js'
import { childFrame, mainFrame } from './fake-browser.fixture.js'
import { LoadedDocument } from './loaded-document.js'

/**
 * The URL the `goto` loaded.
 */
const url = 'http://storybook:6006/iframe.html?id=button--primary&viewMode=story'

/**
 * The page's target id, which is also its main frame's id.
 */
const targetId = 'target-1'

/**
 * The URL the page navigates to on its own.
 */
const burgers = 'http://storybook:6006/categories/burgers'

/**
 * The error Chromium fails a `Runtime.evaluate` in flight with when the main frame starts committing a new document.
 */
const navigatedOrClosed = new CdpError('Runtime.evaluate', -32000, 'Inspected target navigated or closed')

/**
 * A `Page.frameNavigated` event for this frame.
 */
function commit(frame: Record<string, unknown>): CdpEvent {
  return { method: 'Page.frameNavigated', params: { frame }, sessionId: 'session-1' }
}

/**
 * A `Page.frameRequestedNavigation` event: the page asks to navigate this frame to `to`, with this disposition.
 */
function requested(frameId: string, to: string, disposition = 'currentTab'): CdpEvent {
  return {
    method: 'Page.frameRequestedNavigation',
    params: { frameId, reason: 'anchorClick', url: to, disposition },
    sessionId: 'session-1',
  }
}

/**
 * A `Page.frameStartedNavigating` event: this frame starts a navigation of this type to `to`, such as
 * `historyDifferentDocument` for a `history.back()` to another document.
 */
function startedNavigating(frameId: string, to: string, navigationType: string): CdpEvent {
  return {
    method: 'Page.frameStartedNavigating',
    params: { frameId, url: to, loaderId: 'loader-9', navigationType },
    sessionId: 'session-1',
  }
}

/**
 * A `Page.frameStoppedLoading` event for this frame.
 */
function stoppedLoading(frameId: string): CdpEvent {
  return { method: 'Page.frameStoppedLoading', params: { frameId }, sessionId: 'session-1' }
}

/**
 * A `Page.navigatedWithinDocument` event for this frame, such as `history.replaceState` makes.
 */
function navigatedWithinDocument(frameId: string, to: string): CdpEvent {
  return {
    method: 'Page.navigatedWithinDocument',
    params: { frameId, url: to, navigationType: 'historyApi' },
    sessionId: 'session-1',
  }
}

/**
 * The error the page fails with when it navigated to `to` after the `goto` loaded.
 */
function navigatedAway(to: string): PageNavigatedAwayError {
  return new PageNavigatedAwayError(to, `The page navigated to ${to} after ${url} loaded.`)
}

describe('LoadedDocument.observe', () => {
  it.each([
    ['a new document', mainFrame(targetId, burgers, 'loader-9'), burgers],
    ['a new document with a fragment', mainFrame(targetId, `${burgers}#top`, 'loader-9'), `${burgers}#top`],
    [
      'an error page, naming the URL it stands for',
      { ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-9'), unreachableUrl: 'http://gone/' },
      'http://gone/',
    ],
  ])('gives a PageNavigatedAwayError when the main frame commits %s', (_what, frame, shown) => {
    const loaded = new LoadedDocument(url, targetId)
    const error = loaded.observe(commit(frame))

    expect(error).toBeInstanceOf(PageNavigatedAwayError)
    expect(error).toEqual(navigatedAway(shown))
  })

  it.each([
    ['a child frame', childFrame(targetId, 'http://ads:9000/frame')],
    ['a frame of another target', mainFrame('target-other', burgers, 'loader-9')],
  ])("ignores %s's commit", (_which, frame) => {
    const loaded = new LoadedDocument(url, targetId)

    expect(loaded.observe(commit(frame))).toBeUndefined()
    expect(loaded.explain(navigatedOrClosed)).toBe(navigatedOrClosed)
  })

  it.each([
    ['a request', requested(targetId, burgers)],
    ['a started navigation', startedNavigating(targetId, burgers, 'historyDifferentDocument')],
    ['a same-document navigation', navigatedWithinDocument(targetId, `${url}&args=`)],
    ['a stop', stoppedLoading(targetId)],
  ])('gives nothing for %s', (_what, event) => {
    expect(new LoadedDocument(url, targetId).observe(event)).toBeUndefined()
  })
})

describe('LoadedDocument.explain', () => {
  it('gives a PageNavigatedAwayError naming the requested URL for a CdpError while a navigation is pending', () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, burgers))
    expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(burgers))
  })

  it.each([['historyDifferentDocument'], ['differentDocument'], ['reload']])(
    'gives one naming the URL once the main frame has started a %s navigation, which no request may come before',
    (navigationType) => {
      const loaded = new LoadedDocument(url, targetId)

      loaded.observe(startedNavigating(targetId, burgers, navigationType))
      expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(burgers))
    },
  )

  it('names the latest navigation', () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, 'http://storybook:6006/nocontent'))
    loaded.observe(startedNavigating(targetId, 'http://storybook:6006/nocontent', 'differentDocument'))
    loaded.observe(startedNavigating(targetId, burgers, 'historyDifferentDocument'))
    expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(burgers))
  })

  it('keeps a CdpError when no navigation is pending', () => {
    expect(new LoadedDocument(url, targetId).explain(navigatedOrClosed)).toBe(navigatedOrClosed)
  })

  it.each([
    [
      'a PageTimeoutError',
      new PageTimeoutError("The expression evaluated in the page didn't finish within 1 s.", 1000),
    ],
    ['a plain error', new Error('The page was closed.')],
    ['a value that is no error', 'nope'],
  ])('keeps %s while a navigation is pending', (_what, error) => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, burgers))
    expect(loaded.explain(error)).toBe(error)
  })

  it.each([
    ['a request in a child frame', requested('child-frame', burgers)],
    ['a request for a new tab', requested(targetId, burgers, 'newTab')],
    ['a request for a download', requested(targetId, burgers, 'download')],
    ['a navigation started in a child frame', startedNavigating('child-frame', burgers, 'differentDocument')],
    ['a started same-document navigation', startedNavigating(targetId, `${url}#top`, 'sameDocument')],
    ['a started same-document history traversal', startedNavigating(targetId, url, 'historySameDocument')],
  ])('ignores %s', (_what, event) => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(event)
    expect(loaded.explain(navigatedOrClosed)).toBe(navigatedOrClosed)
  })

  it('forgets the navigation once the main frame stops loading without a new document, as after a 204 or a download', () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, 'http://storybook:6006/nocontent'))
    loaded.observe(startedNavigating(targetId, 'http://storybook:6006/nocontent', 'differentDocument'))
    loaded.observe(stoppedLoading(targetId))
    expect(loaded.explain(navigatedOrClosed)).toBe(navigatedOrClosed)
  })

  it('forgets the navigation that a same-document history traversal cancels, from the stop that follows', () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, burgers))
    loaded.observe(startedNavigating(targetId, burgers, 'differentDocument'))
    loaded.observe(startedNavigating(targetId, url, 'historySameDocument'))
    expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(burgers))
    loaded.observe(stoppedLoading(targetId))
    expect(loaded.explain(navigatedOrClosed)).toBe(navigatedOrClosed)
  })

  it('keeps the navigation when a child frame stops loading', () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, burgers))
    loaded.observe(stoppedLoading('child-frame'))
    expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(burgers))
  })

  it('keeps the navigation through history.replaceState, which leaves it going', () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, burgers))
    loaded.observe(navigatedWithinDocument(targetId, `${url}&args=`))
    expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(burgers))
  })

  it("gives the commit's error for a CdpError once the main frame has committed, though it has stopped loading since", () => {
    const loaded = new LoadedDocument(url, targetId)

    loaded.observe(requested(targetId, burgers))
    loaded.observe(commit(mainFrame(targetId, `${burgers}#top`, 'loader-9')))
    loaded.observe(stoppedLoading(targetId))
    expect(loaded.explain(navigatedOrClosed)).toEqual(navigatedAway(`${burgers}#top`))
  })
})
