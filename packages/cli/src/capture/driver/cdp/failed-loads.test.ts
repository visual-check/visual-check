import { describe, expect, it } from 'vitest'
import type { CdpEvent } from './cdp-connection.js'
import { failedLoadOf, loadPageErrorOf } from './failed-loads.js'

const url = 'http://127.0.0.1:6006/assets/card.stories-B0zV1TVO.js'

/**
 * Builds a `Log.entryAdded` event of the session with the entry's fields, a failed load's by default.
 */
function logEntry(entry: Record<string, unknown> = {}, sessionId = 'session'): CdpEvent {
  return {
    method: 'Log.entryAdded',
    params: {
      entry: {
        source: 'network',
        level: 'error',
        text: 'Failed to load resource: net::ERR_EMPTY_RESPONSE',
        url,
        ...entry,
      },
    },
    sessionId,
  }
}

describe('failedLoadOf', () => {
  it('reads a network error the session logged', () => {
    expect(failedLoadOf(logEntry(), 'session')).toEqual({ url, error: 'net::ERR_EMPTY_RESPONSE' })
  })

  it('ignores a cancellation', () => {
    expect(failedLoadOf(logEntry({ text: 'Failed to load resource: net::ERR_ABORTED' }), 'session')).toBeUndefined()
  })

  it('ignores an HTTP error status', () => {
    const text = 'Failed to load resource: the server responded with a status of 404 (Not Found)'

    expect(failedLoadOf(logEntry({ text }), 'session')).toBeUndefined()
  })

  it('ignores another source or level', () => {
    expect(failedLoadOf(logEntry({ source: 'javascript' }), 'session')).toBeUndefined()
    expect(failedLoadOf(logEntry({ level: 'warning' }), 'session')).toBeUndefined()
  })

  it('ignores another session and the browser level', () => {
    expect(failedLoadOf(logEntry({}, 'other'), 'session')).toBeUndefined()
    expect(failedLoadOf({ ...logEntry(), sessionId: undefined }, 'session')).toBeUndefined()
  })

  it('ignores an entry without a URL, and another event', () => {
    expect(failedLoadOf(logEntry({ url: undefined }), 'session')).toBeUndefined()
    expect(failedLoadOf({ method: 'Log.entryAdded', params: {}, sessionId: 'session' }, 'session')).toBeUndefined()
    expect(failedLoadOf({ ...logEntry(), method: 'Runtime.consoleAPICalled' }, 'session')).toBeUndefined()
  })
})

/**
 * The text Blink logs for a load that got the HTTP status `status`, with its status text in brackets.
 */
function statusText(status: number, statusText = ''): string {
  return `Failed to load resource: the server responded with a status of ${status} (${statusText})`
}

describe('loadPageErrorOf', () => {
  it('reads a network error the session logged', () => {
    expect(loadPageErrorOf(logEntry(), 'session')).toEqual({
      kind: 'load',
      text: url,
      loadError: 'net::ERR_EMPTY_RESPONSE',
    })
  })

  it('reads an error status the server answered with its status text', () => {
    expect(loadPageErrorOf(logEntry({ text: statusText(404, 'Not Found') }), 'session')).toEqual({
      kind: 'load',
      text: url,
      loadError: 'HTTP 404',
    })
  })

  it('reads an error status without a status text, as a service worker gives it', () => {
    expect(loadPageErrorOf(logEntry({ text: statusText(404) }), 'session')).toEqual({
      kind: 'load',
      text: url,
      loadError: 'HTTP 404',
    })
    expect(loadPageErrorOf(logEntry({ text: statusText(500) }), 'session')).toEqual({
      kind: 'load',
      text: url,
      loadError: 'HTTP 500',
    })
  })

  it('ignores a status under 400', () => {
    expect(loadPageErrorOf(logEntry({ text: statusText(399) }), 'session')).toBeUndefined()
    expect(loadPageErrorOf(logEntry({ text: statusText(302, 'Found') }), 'session')).toBeUndefined()
  })

  it('ignores a cancellation and another text', () => {
    expect(loadPageErrorOf(logEntry({ text: 'Failed to load resource: net::ERR_ABORTED' }), 'session')).toBeUndefined()
    expect(loadPageErrorOf(logEntry({ text: 'Something else' }), 'session')).toBeUndefined()
  })

  it('ignores another source or level', () => {
    expect(loadPageErrorOf(logEntry({ source: 'javascript', text: statusText(404) }), 'session')).toBeUndefined()
    expect(loadPageErrorOf(logEntry({ level: 'warning', text: statusText(404) }), 'session')).toBeUndefined()
  })

  it('ignores another session and the browser level', () => {
    expect(loadPageErrorOf(logEntry({ text: statusText(404) }, 'other'), 'session')).toBeUndefined()
    expect(loadPageErrorOf({ ...logEntry({ text: statusText(404) }), sessionId: undefined }, 'session')).toBeUndefined()
  })

  it('ignores an entry without a URL, and another event', () => {
    expect(loadPageErrorOf(logEntry({ url: undefined, text: statusText(404) }), 'session')).toBeUndefined()
    expect(loadPageErrorOf({ method: 'Log.entryAdded', params: {}, sessionId: 'session' }, 'session')).toBeUndefined()
    expect(loadPageErrorOf({ ...logEntry(), method: 'Runtime.consoleAPICalled' }, 'session')).toBeUndefined()
  })
})
