import { describe, expect, it } from 'vitest'
import {
  BrowserExitedError,
  BrowserLaunchError,
  browserThatFailedToStart,
  describeExit,
  PageCrashedError,
  PageLoadError,
  PageNavigatedAwayError,
  PageTimeoutError,
} from './driver.js'

describe('describeExit', () => {
  it('names the exit code', () => {
    expect(describeExit({ code: 1, signal: null, error: undefined }, 'while in use')).toBe(
      'The browser exited with code 1 while in use.',
    )
  })

  it('names the signal when there is no exit code', () => {
    expect(describeExit({ code: null, signal: 'SIGSEGV', error: undefined }, 'before it answered')).toBe(
      'The browser was killed by signal SIGSEGV before it answered.',
    )
  })

  it('says only that it exited when neither is known', () => {
    expect(describeExit({ code: null, signal: null, error: undefined }, 'while in use')).toBe(
      'The browser exited while in use.',
    )
  })

  it("says the browser couldn't start, and why", () => {
    expect(describeExit({ code: null, signal: null, error: new Error('spawn docker ENOENT') }, 'while in use')).toBe(
      "The browser couldn't start: spawn docker ENOENT.",
    )
  })

  it("doesn't double the period of a reason that ends with one", () => {
    expect(describeExit({ code: null, signal: null, error: new Error('Docker is not running.') }, 'while in use')).toBe(
      "The browser couldn't start: Docker is not running.",
    )
  })
})

describe('BrowserExitedError', () => {
  it('names the exit and keeps the output lines, with no graphics failure unless given', () => {
    const error = new BrowserExitedError({ code: 139, signal: null, error: undefined }, ['Segmentation fault'])

    expect(error).toMatchObject({
      name: 'BrowserExitedError',
      message: 'The browser exited with code 139 while in use.',
      output: ['Segmentation fault'],
      graphicsFailed: false,
    })
  })

  it('keeps whether its graphics process failed', () => {
    expect(new BrowserExitedError({ code: 133, signal: null, error: undefined }, [], true).graphicsFailed).toBe(true)
  })
})

describe('PageCrashedError', () => {
  it('says the page crashed', () => {
    expect(new PageCrashedError()).toMatchObject({ name: 'PageCrashedError', message: 'The page crashed.' })
  })
})

describe('PageTimeoutError', () => {
  it('keeps the message and the time limit that passed', () => {
    expect(new PageTimeoutError("The page didn't load http://storybook/a within 10 s.", 10_000)).toMatchObject({
      name: 'PageTimeoutError',
      message: "The page didn't load http://storybook/a within 10 s.",
      timeoutMs: 10_000,
    })
  })
})

describe('PageLoadError', () => {
  it("names the URL and keeps the browser's network error", () => {
    expect(new PageLoadError('http://storybook/a', 'net::ERR_CONNECTION_REFUSED')).toMatchObject({
      name: 'PageLoadError',
      message: "The page couldn't load http://storybook/a: net::ERR_CONNECTION_REFUSED",
      reason: 'net::ERR_CONNECTION_REFUSED',
    })
  })
})

describe('PageNavigatedAwayError', () => {
  it('keeps the URL the page went to and the message', () => {
    expect(new PageNavigatedAwayError('http://storybook/b', 'The page navigated to http://storybook/b.')).toMatchObject(
      {
        name: 'PageNavigatedAwayError',
        message: 'The page navigated to http://storybook/b.',
        url: 'http://storybook/b',
      },
    )
  })
})

describe('BrowserLaunchError', () => {
  it('keeps the message, the output lines and whether it exited, with no graphics failure unless given', () => {
    expect(
      new BrowserLaunchError('The browser exited with code 1 before it answered.', ['bad flag'], { exited: true }),
    ).toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser exited with code 1 before it answered.',
      output: ['bad flag'],
      exited: true,
      graphicsFailed: false,
    })
  })

  it('keeps whether its graphics process failed', () => {
    expect(
      new BrowserLaunchError('The browser exited with code 133 before it answered.', [], {
        exited: true,
        graphicsFailed: true,
      }).graphicsFailed,
    ).toBe(true)
  })
})

describe('browserThatFailedToStart', () => {
  it('gives empty ended streams, settles exited with the error and ignores kill', async () => {
    const error = new Error('spawn ENOENT')
    const browser = browserThatFailedToStart(error)

    expect(await browser.exited).toEqual({ code: null, signal: null, error })
    expect(await browser.fromBrowser.toArray()).toEqual([])
    expect(await browser.output.toArray()).toEqual([])
    expect(() => browser.kill()).not.toThrow()
  })
})
