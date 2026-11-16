import { describe, expect, it } from 'vitest'
import { BaselineError } from '../baselines/baseline-error.js'
import { BrowserMismatchError } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import { BrowserExitedError, BrowserLaunchError } from '../capture/driver/driver.js'
import { ContainerError } from '../container/container-error.js'
import { ReportError } from '../report/report-folder.js'
import { type StopContext, stopMessageOf } from './stop-message.js'

/**
 * The browser package every context holds.
 */
const browserPackage: BrowserPackage = {
  packageVersion: '157.0.0',
  chromium: '157.0.8103.78',
  image: { tag: 'ghcr.io/visual-check/chromium:157.0.0', digest: 'sha256:0' },
  headlessShell: '/opt/chromium/chrome-headless-shell',
  sha256: {
    linux64: '1'.repeat(64),
    'linux-arm64': '2'.repeat(64),
    'mac-x64': '3'.repeat(64),
    'mac-arm64': '4'.repeat(64),
    win64: '5'.repeat(64),
  },
}

/**
 * Builds a context for a run in visual-check's container on linux/amd64, with the given fields changed.
 */
function contextOf(overrides: Partial<StopContext> = {}): StopContext {
  return {
    cwd: '/project',
    place: { in: 'container', platform: 'linux/amd64', route: 'host' },
    config: { platform: 'linux/amd64', image: undefined },
    browserPackage,
    environment: { VISUAL_CHECK_CACHE_DIR: '/cache' },
    insideContainer: false,
    ...overrides,
  }
}

describe('stopMessageOf', () => {
  it('names the baseline, its reason and what to do for a baseline that fails to decode', () => {
    const error = new BaselineError('decode', '/project/.visual-check/baselines/a.png', new Error('bad png'))

    expect(stopMessageOf(error, contextOf(), false)).toBe(
      "visual-check couldn't decode the baseline .visual-check/baselines/a.png: bad png. " +
        'Delete it or restore it from git, then run visual-check again.\n',
    )
  })

  it('names the report folder, its reason and what to do for a report folder that fails to clear', () => {
    const error = new ReportError('clear', '/project/.visual-check/report', new Error('busy'))

    expect(stopMessageOf(error, contextOf(), false)).toBe(
      "visual-check couldn't clear .visual-check/report: busy. Check that visual-check can remove it.\n",
    )
  })

  it('gives the error, the next step and the output for a browser that exited with output', () => {
    const error = new BrowserExitedError({ code: 137, signal: null, error: undefined }, ['out of memory'])

    expect(stopMessageOf(error, contextOf(), true)).toBe(
      'The browser exited with code 137 while in use.\n' +
        "The browser's output below may say why. Running out of memory is a common cause. Run visual-check again.\n" +
        "The browser's last output:\n  out of memory\n",
    )
  })

  it('gives the error and the next step alone for a browser that exited without output', () => {
    const error = new BrowserExitedError({ code: 137, signal: null, error: undefined }, [])

    expect(stopMessageOf(error, contextOf(), true)).toBe(
      'The browser exited with code 137 while in use.\nRunning out of memory is a common cause. Run visual-check again.\n',
    )
  })

  it('names what to check for a launch that failed in the container', () => {
    const error = new BrowserLaunchError('The browser failed to launch.', [], { exited: true })

    expect(stopMessageOf(error, contextOf(), false)).toBe(
      'The browser failed to launch.\nCheck that Docker can run images for linux/amd64, then run visual-check again.\n',
    )
  })

  it('names the missing library and both ways out for a launch that failed on the host', () => {
    const output = ['chrome: error while loading shared libraries: libnss3.so: cannot open shared object file']
    const error = new BrowserLaunchError('The browser failed to launch.', output, { exited: true })
    const context = contextOf({
      place: { in: 'host', platform: 'linux64' },
      config: { platform: 'host', image: undefined },
    })

    expect(stopMessageOf(error, context, false)).toBe(
      "The browser can't start because libnss3.so is missing.\n" +
        "Install the libraries the headless shell needs, since visual-check doesn't install system packages, or set " +
        "platform to 'linux/amd64' in the config to run the browser in visual-check's container.\n" +
        "To list every missing library, run: ldd '/cache/chromium/157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell' | grep 'not found'\n" +
        "The browser's last output:\n  " +
        `${output[0]}\n`,
    )
  })

  it('gives the platform problem for a browser whose graphics process fails before any capture', () => {
    const error = new BrowserExitedError({ code: 1, signal: null, error: undefined }, ['gpu'], true)

    expect(stopMessageOf(error, contextOf(), false)).toBe(
      "The browser exited before its first capture because its graphics process can't start: this machine can't run " +
        'linux/amd64, as happens when Docker emulates it with QEMU.\n' +
        "Turn on Rosetta in your Docker runtime, or set platform to 'linux/arm64' in the config, which changes it for " +
        "the whole project.\nThe browser's last output:\n  gpu\n",
    )
  })

  it('gives the next step instead of the platform problem once a snapshot was captured', () => {
    const error = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [], true)

    expect(stopMessageOf(error, contextOf(), true)).toBe(
      'The browser exited with code 1 while in use.\nRunning out of memory is a common cause. Run visual-check again.\n',
    )
  })

  it('gives the message and a newline for a failed download and for a version mismatch', () => {
    expect(stopMessageOf(new BrowserDownloadError('Download failed.'), contextOf(), false)).toBe('Download failed.\n')
    expect(stopMessageOf(new BrowserMismatchError('Wrong build.'), contextOf(), false)).toBe('Wrong build.\n')
  })

  it('gives the Docker problem for a container error', () => {
    const error = new ContainerError('Docker is not running.')

    expect(stopMessageOf(error, contextOf(), false)).toMatch(/^Docker is not running\.\n/)
  })

  it('gives undefined for any other error', () => {
    expect(stopMessageOf(new Error('boom'), contextOf(), false)).toBeUndefined()
    expect(stopMessageOf('boom', contextOf(), false)).toBeUndefined()
  })
})
