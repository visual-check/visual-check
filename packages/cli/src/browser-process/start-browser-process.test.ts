import { existsSync } from 'node:fs'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createFakeBrowser, type FakeBrowser, type FakeBrowserOptions } from './fake-browser.fixture.js'
import { startBrowserProcess } from './start-browser-process.js'

/**
 * Reads a stream to its end.
 */
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ''

  for await (const chunk of stream) {
    text += String(chunk)
  }

  return text
}

/**
 * Creates a fake browser that is removed when the test finishes.
 */
function fakeBrowser(options?: FakeBrowserOptions): FakeBrowser {
  const fake = createFakeBrowser(options)

  onTestFinished(fake.remove)

  return fake
}

describe('startBrowserProcess', () => {
  it('carries bytes both ways and passes stdout and stderr as output', async () => {
    const { executable, profileDir } = fakeBrowser()
    const browser = startBrowserProcess({ executable, profileDir })(['--x'])
    const received = readAll(browser.fromBrowser)
    const output = readAll(browser.output)

    browser.toBrowser.write('{"id":1}\0')
    browser.toBrowser.end('{"id":2}\0')

    expect(await received).toBe('{"id":1}\0{"id":2}\0')
    expect((await output).split('\n').sort()).toEqual(['', 'to stderr', 'to stdout'])
    expect(await browser.exited).toEqual({ code: 0, signal: null, error: undefined })
  })

  it('removes the profile folder before exited settles', async () => {
    const { executable, profileDir } = fakeBrowser()
    const browser = startBrowserProcess({ executable, profileDir })([])

    browser.output.resume()
    browser.fromBrowser.resume()
    browser.toBrowser.end()
    await browser.exited

    expect(existsSync(profileDir)).toBe(false)
  })

  it('settles exited with the error when the executable is missing, and removes the folder', async () => {
    const { executable, profileDir } = fakeBrowser()
    const browser = startBrowserProcess({ executable: `${executable}-missing`, profileDir })([])
    const exit = await browser.exited

    expect(exit.code).toBeNull()
    expect(exit.signal).toBeNull()
    expect((exit.error as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect(existsSync(profileDir)).toBe(false)
    expect(() => browser.kill()).not.toThrow()
  })

  it("doesn't signal the CLI's own process group when kill() comes before the start's error", async () => {
    const { executable, profileDir } = fakeBrowser()
    const browser = startBrowserProcess({ executable: `${executable}-missing`, profileDir })([])

    // Node reports the failed start on the next tick, and until then the child has no pid.
    browser.kill()

    expect(((await browser.exited).error as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  it('settles exited with the error when spawn throws, such as for a NUL byte, and removes the folder', async () => {
    const { executable, profileDir } = fakeBrowser()
    const browser = startBrowserProcess({ executable: `${executable}\0`, profileDir })([])

    expect((await browser.exited).error).toBeInstanceOf(Error)
    expect(existsSync(profileDir)).toBe(false)
    expect(() => browser.kill()).not.toThrow()
  })

  it('ends the browser with SIGKILL on kill()', async () => {
    const { executable, profileDir } = fakeBrowser()
    const browser = startBrowserProcess({ executable, profileDir })([])

    browser.output.resume()
    browser.fromBrowser.resume()
    await new Promise((resolve) => browser.output.once('data', resolve))
    browser.kill()

    expect(await browser.exited).toEqual({ code: null, signal: 'SIGKILL', error: undefined })
    expect(existsSync(profileDir)).toBe(false)
  })

  it("ends the browser's helper processes too on kill(), so exited settles at once", async () => {
    const { executable, profileDir } = fakeBrowser({ withGrandchild: true })
    const browser = startBrowserProcess({ executable, profileDir })([])
    const started = Date.now()

    browser.fromBrowser.resume()
    browser.output.resume()
    await new Promise((resolve) => browser.output.once('data', resolve))
    // Gives the grandchild time to start, since it starts before the first line.
    await new Promise((resolve) => setTimeout(resolve, 300))
    browser.kill()

    expect((await browser.exited).signal).toBe('SIGKILL')
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
