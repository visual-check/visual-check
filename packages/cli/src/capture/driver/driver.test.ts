import { describe, expect, it } from 'vitest'
import {
  BrowserExitedError,
  BrowserLaunchError,
  describeExit,
  PageCrashedError,
  PageNavigatedAwayError,
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
  it('names the exit and keeps the output lines', () => {
    const error = new BrowserExitedError({ code: 139, signal: null, error: undefined }, ['Segmentation fault'])

    expect(error).toMatchObject({
      name: 'BrowserExitedError',
      message: 'The browser exited with code 139 while in use.',
      output: ['Segmentation fault'],
    })
  })
})

describe('PageCrashedError', () => {
  it('says the page crashed', () => {
    expect(new PageCrashedError()).toMatchObject({ name: 'PageCrashedError', message: 'The page crashed.' })
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
  it('keeps the message and the output lines', () => {
    expect(new BrowserLaunchError('The browser exited with code 1 before it answered.', ['bad flag'])).toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser exited with code 1 before it answered.',
      output: ['bad flag'],
    })
  })
})
