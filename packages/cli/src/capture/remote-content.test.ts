import { createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  type FakeBox,
  fakeElement,
  fakeFrame,
  fakeImg,
  fakePageDocument,
  fakeShadowRoot,
  fakeSvgImage,
  storybookOrigin,
} from './remote-content.fixture.js'
import { remoteContentFunction } from './remote-content.js'

/**
 * The remote content search created in a fake page, as the page script creates it.
 */
interface RemoteContentPage {
  /**
   * The browser's own `setTimeout`, as the page script kept it.
   */
  setTimer: Mock<(callback: () => void, ms: number) => unknown>
  /**
   * The browser's own `clearTimeout`, as the page script kept it.
   */
  clearTimer: Mock<(timer: unknown) => void>
  /**
   * Runs JavaScript in the page.
   */
  run: (code: string) => unknown
  /**
   * Starts the search with this time limit, and promises its answer as the driver gives it: passed through JSON.
   */
  find: (timeoutMs: number) => Promise<unknown>
}

/**
 * The browser's own timers, as the page script kept them. Each has a default, given with it.
 */
interface KeptTimers {
  /**
   * The browser's own `setTimeout`: the test's clock by default.
   */
  setTimer?: (callback: () => void, ms: number) => unknown
  /**
   * The browser's own `clearTimeout`: the test's clock by default.
   */
  clearTimer?: (timer: unknown) => void
}

/**
 * Builds a fake page whose `document` is this one, with these recorded shadow roots and timers, and creates the search
 * in it.
 */
function openSearch(document: object, shadowRoots: object[] = [], timers: KeptTimers = {}): RemoteContentPage {
  const context = createContext({ URL, document, setTimeout, clearTimeout })
  const run = (code: string): unknown => runInContext(code, context)
  const setTimer = vi.fn(timers.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms)))
  const clearTimer = vi.fn(
    timers.clearTimer ??
      ((timer: unknown): void => {
        clearTimeout(timer as Parameters<typeof clearTimeout>[0])
      }),
  )
  const create = run(remoteContentFunction) as (context: object) => (timeoutMs: number) => Promise<unknown>
  const search = create({ shadowRoots, setTimer, clearTimer, stateGlobal: '__visualCheck' })

  return {
    setTimer,
    clearTimer,
    run,
    find: async (timeoutMs) => JSON.parse(JSON.stringify(await search(timeoutMs))),
  }
}

/**
 * Searches a fake page whose `document` is this one, with these recorded shadow roots, with a time limit of 10 s,
 * running the page's timers until it answers. Gives its answer.
 */
async function remoteContentOf(document: object, shadowRoots: object[] = []): Promise<unknown> {
  const answer = openSearch(document, shadowRoots).find(10_000)

  await vi.runAllTimersAsync()

  return await answer
}

/**
 * Builds what the search answers when it found these items.
 */
function foundAnswer(...items: Record<string, unknown>[]): Record<string, unknown> {
  return { outcome: 'found', items }
}

/**
 * Builds an item the search finds: remote content from `host`, whose name is `host` without its port, in `box`, 10, 20,
 * 100 × 50 by default.
 */
function item(host: string, box: FakeBox = { x: 10, y: 20, width: 100, height: 50 }): Record<string, unknown> {
  return { host, hostname: host.replace(/:\d+$/, ''), ...box }
}

/**
 * Builds a `div` whose computed `background-image` is `value`.
 */
function background(value: string, box?: FakeBox): object {
  return fakeElement('div', { box, styles: { 'background-image': value } })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('images', () => {
  it('finds an <img> by the source it shows, as a <picture> or srcset picks it', async () => {
    const picked = fakeImg({ src: `${storybookOrigin}/fallback.png`, currentSrc: 'https://images.example.com/a.jpg' })
    const { document } = fakePageDocument({ elements: [picked] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('images.example.com')))
  })

  it("finds an <img> by its src when it picked nothing yet, with the host's port and in lowercase", async () => {
    const image = fakeImg({ src: 'https://Images.Example.com:8443/a.jpg', currentSrc: '' })
    const { document } = fakePageDocument({ elements: [image] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('images.example.com:8443')))
  })

  it('finds an SVG <image> by href, and by xlink:href resolved against its base URL', async () => {
    const byHref = fakeSvgImage({ href: 'https://a.example.com/icon.png' })
    const byXlink = fakeSvgImage({ xlinkHref: 'icon.png', baseURI: 'https://b.example.com/sprites/' })
    const { document } = fakePageDocument({ elements: [byHref, byXlink] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('a.example.com'), item('b.example.com')))
  })

  it("finds a video's poster, and not a video without one", async () => {
    const withPoster = fakeElement('video', { properties: { poster: 'https://posters.example.com/a.jpg' } })
    const withoutPoster = fakeElement('video', { properties: { poster: '' } })
    const { document } = fakePageDocument({ elements: [withPoster, withoutPoster] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('posters.example.com')))
  })
})

describe('CSS images', () => {
  const properties = ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source', 'content']

  it.each(properties)('finds a remote URL in %s on the element', async (property) => {
    const element = fakeElement('div', { styles: { [property]: 'url("https://css.example.com/a.png")' } })
    const { document } = fakePageDocument({ elements: [element] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('css.example.com')))
  })

  it.each(
    properties.flatMap((property) => [
      ['before', property],
      ['after', property],
    ]),
  )('finds a remote URL in %s on ::%s, in the box of its element', async (pseudoElement, property) => {
    const styles = { content: '""', [property]: 'url("https://css.example.com/a.png")' }
    const element = fakeElement('div', { [pseudoElement]: styles })
    const { document } = fakePageDocument({ elements: [element] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('css.example.com')))
  })

  it('finds a remote URL in list-style-image on the element, and not on ::before, where it does nothing', async () => {
    const listItem = fakeElement('li', { styles: { 'list-style-image': 'url("https://a.example.com/bullet.png")' } })
    const pseudoElement = fakeElement('li', {
      before: { content: '""', 'list-style-image': 'url("https://b.example.com/bullet.png")' },
    })
    const { document } = fakePageDocument({ elements: [listItem, pseudoElement] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('a.example.com')))
  })

  it.each([
    ['img', 'http://www.w3.org/1999/xhtml'],
    ['input', 'http://www.w3.org/1999/xhtml'],
    ['g', 'http://www.w3.org/2000/svg'],
  ])(
    'skips ::before and ::after on <%s>, which never generates them, keeping its own style',
    async (localName, namespaceURI) => {
      const element = fakeElement(localName, {
        namespaceURI,
        styles: { 'mask-image': 'url("https://own.example.com/a.png")' },
        before: { content: '""', 'background-image': 'url("https://before.example.com/a.png")' },
        after: { content: '""', 'background-image': 'url("https://after.example.com/a.png")' },
        properties: { src: '' },
      })
      const { document } = fakePageDocument({ elements: [element] })

      expect(await remoteContentOf(document)).toEqual(foundAnswer(item('own.example.com')))
    },
  )

  it.each(['none', 'normal'])('skips a ::before whose content is %s, as it is not generated', async (content) => {
    const element = fakeElement('div', {
      before: { content, 'background-image': 'url("https://css.example.com/a.png")' },
    })
    const { document } = fakePageDocument({ elements: [element] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })

  it('finds every url() in a value, image-set() included, one item per host', async () => {
    const layers = background('url("https://a.example.com/1.png"), url("https://b.example.com/2.png")')
    const set = background('image-set(url("https://c.example.com/1x.png") 1x, url("https://c.example.com/2x.png") 2x)')
    const escaped = background('url("https://d.example.com/a\\"b.png")')
    const { document } = fakePageDocument({ elements: [layers, set, escaped] })

    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('a.example.com'), item('b.example.com'), item('c.example.com'), item('d.example.com')),
    )
  })

  it('gives one item per element and host, across its images', async () => {
    const element = fakeElement('div', {
      styles: {
        'background-image': 'url("https://a.example.com/1.png")',
        'mask-image': 'url("https://a.example.com/2.png")',
      },
      after: { content: 'url("https://a.example.com/3.png")' },
    })
    const { document } = fakePageDocument({ elements: [element] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('a.example.com')))
  })
})

describe('what never counts', () => {
  it.each([
    `${storybookOrigin}/static/a.png`,
    'data:image/png;base64,AAAA',
    'blob:http://localhost:6006/1f0e',
    'about:blank',
    'ftp://files.example.com/a.png',
  ])('skips %s', async (url) => {
    const { document } = fakePageDocument({ elements: [fakeImg({ src: url }), background(`url("${url}")`)] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })

  it('skips none values and elements without images', async () => {
    const { document } = fakePageDocument({ elements: [background('none'), fakeElement('p')] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })

  it('skips boxes with no area', async () => {
    const flat = background('url("https://a.example.com/1.png")', { x: 0, y: 0, width: 100, height: 0 })
    const narrow = fakeImg({ src: 'https://a.example.com/2.png', box: { x: 0, y: 0, width: 0, height: 10 } })
    const { document } = fakePageDocument({ elements: [flat, narrow] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })
})

describe('hidden elements', () => {
  it.each(['hidden', 'collapse'])(
    'are skipped when their visibility is %s, with their ::before and ::after',
    async (visibility) => {
      const image = fakeImg({ src: 'https://a.example.com/a.png', visibility })
      const styled = fakeElement('div', {
        styles: { visibility, 'background-image': 'url("https://b.example.com/b.png")' },
        before: { content: '""', 'background-image': 'url("https://c.example.com/c.png")' },
      })
      const { document } = fakePageDocument({ elements: [image, styled] })

      expect(await remoteContentOf(document)).toEqual(foundAnswer())
    },
  )

  it('show a ::before that sets its own visibility back to visible', async () => {
    const element = fakeElement('div', {
      styles: { visibility: 'hidden', 'background-image': 'url("https://a.example.com/a.png")' },
      before: { content: '""', visibility: 'visible', 'background-image': 'url("https://b.example.com/b.png")' },
    })
    const { document } = fakePageDocument({ elements: [element] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('b.example.com')))
  })

  it('include frames, which then give nothing, cross-origin or same-origin', async () => {
    const frameDocument = fakePageDocument({ elements: [fakeImg({ src: 'https://a.example.com/a.png' })] }).document
    const sameOrigin = fakeFrame({ contentDocument: frameDocument, visibility: 'hidden' })
    const crossOrigin = fakeFrame({ src: 'https://embed.example.com/', visibility: 'hidden' })
    const { document } = fakePageDocument({ elements: [sameOrigin, crossOrigin] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })
})

describe('the roots', () => {
  it('include every recorded shadow root, closed ones too, and every open one, nested ones too', async () => {
    const inNested = fakeImg({ src: 'https://nested.example.com/a.png' })
    const nested = fakeShadowRoot([inNested])
    const inOpen = fakeImg({ src: 'https://open.example.com/a.png' })
    const open = fakeShadowRoot([inOpen, fakeElement('my-card', { shadowRoot: nested })])
    const closed = fakeShadowRoot([fakeImg({ src: 'https://closed.example.com/a.png' })])
    const { document } = fakePageDocument({ elements: [fakeElement('my-app', { shadowRoot: open })] })

    expect(await remoteContentOf(document, [closed])).toEqual(
      foundAnswer(item('closed.example.com'), item('open.example.com'), item('nested.example.com')),
    )
  })

  it("add the page's scroll to every box", async () => {
    const { document } = fakePageDocument({
      elements: [fakeImg({ src: 'https://a.example.com/a.png' })],
      scroll: { x: 5, y: 300.5 },
    })

    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('a.example.com', { x: 15, y: 320.5, width: 100, height: 50 })),
    )
  })
})

describe('frames', () => {
  it('take a cross-origin iframe or frame as its whole border box, as the host of its src', async () => {
    const iframe = fakeFrame({ src: 'https://embed.example.com/player', border: 2, padding: 4 })
    const frame = fakeFrame({ src: 'https://frames.example.com/', localName: 'frame' })
    const sameOrigin = fakeFrame({ src: `${storybookOrigin}/other.html` })
    const { document } = fakePageDocument({ elements: [iframe, frame, sameOrigin] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer(item('embed.example.com'), item('frames.example.com')))
  })

  it("search a same-origin frame's document, moved by the frame's content box and clipped to it", async () => {
    const inside = fakeImg({ src: 'https://a.example.com/a.png', box: { x: 10, y: 10, width: 200, height: 20 } })
    const local = fakeImg({ src: `${storybookOrigin}/a.png` })
    const frameDocument = fakePageDocument({ elements: [inside, local] }).document
    const frame = fakeFrame({
      contentDocument: frameDocument,
      src: `${storybookOrigin}/frame.html`,
      box: { x: 100, y: 50, width: 150, height: 100 },
      border: 2,
      padding: 3,
    })
    const { document } = fakePageDocument({ elements: [frame], scroll: { x: 0, y: 40 } })

    // The content box starts at 105, 55 and is 140 × 90, so the image starts at 115, 65 and is clipped at 245.
    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('a.example.com', { x: 115, y: 105, width: 130, height: 20 })),
    )
  })

  it("search a srcdoc frame's document, and its open shadow roots", async () => {
    const inShadow = fakeImg({ src: 'https://shadow.example.com/a.png', box: { x: 0, y: 0, width: 10, height: 10 } })
    const host = fakeElement('my-card', { shadowRoot: fakeShadowRoot([inShadow]) })
    const frameDocument = fakePageDocument({ elements: [host] }).document
    const frame = fakeFrame({ contentDocument: frameDocument, box: { x: 30, y: 40, width: 100, height: 100 } })
    const { document } = fakePageDocument({ elements: [frame] })

    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('shadow.example.com', { x: 30, y: 40, width: 10, height: 10 })),
    )
  })

  it("search the closed shadow roots a same-origin frame's page script recorded", async () => {
    const inClosed = fakeImg({ src: 'https://closed.example.com/a.png', box: { x: 0, y: 0, width: 10, height: 10 } })
    const closedRoot = fakeShadowRoot([inClosed])
    const frameDocument = fakePageDocument().document
    const frame = fakeFrame({
      contentDocument: frameDocument,
      contentWindow: { __visualCheck: { shadowRoots: [closedRoot] } },
      box: { x: 30, y: 40, width: 100, height: 100 },
    })
    const bare = fakeFrame({ contentDocument: fakePageDocument().document, contentWindow: {} })
    const notAList = fakeFrame({
      contentDocument: fakePageDocument().document,
      contentWindow: { __visualCheck: { shadowRoots: 'none' } },
    })
    const { document } = fakePageDocument({ elements: [frame, bare, notAList] })

    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('closed.example.com', { x: 30, y: 40, width: 10, height: 10 })),
    )
  })

  it("search nested frames, moving boxes by every frame's content box and clipping them to every one", async () => {
    const inner = fakeImg({ src: 'https://a.example.com/a.png', box: { x: 5, y: -10, width: 100, height: 100 } })
    const cut = fakeImg({ src: 'https://b.example.com/b.png', box: { x: 0, y: 200, width: 10, height: 10 } })
    const innerDocument = fakePageDocument({ elements: [inner, cut] }).document
    const innerFrame = fakeFrame({ contentDocument: innerDocument, box: { x: 20, y: 20, width: 300, height: 300 } })
    const outerDocument = fakePageDocument({ elements: [innerFrame] }).document
    const outerFrame = fakeFrame({ contentDocument: outerDocument, box: { x: 100, y: 100, width: 80, height: 60 } })
    const { document } = fakePageDocument({ elements: [outerFrame] })

    // The inner frame's content starts at 120, 120, and is clipped to it and to the outer one's, 100, 100 to 180, 160.
    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('a.example.com', { x: 125, y: 120, width: 55, height: 40 })),
    )
  })

  it('give nothing from inside a frame whose content box has no area', async () => {
    const frameDocument = fakePageDocument({ elements: [fakeImg({ src: 'https://a.example.com/a.png' })] }).document
    const frame = fakeFrame({
      contentDocument: frameDocument,
      box: { x: 0, y: 0, width: 100, height: 50 },
      padding: 25,
    })
    const { document } = fakePageDocument({ elements: [frame] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })

  it('take a cross-origin iframe inside a same-origin frame as its border box, moved and clipped', async () => {
    const embed = fakeFrame({ src: 'https://embed.example.com/', box: { x: 50, y: 10, width: 200, height: 30 } })
    const frameDocument = fakePageDocument({ elements: [embed] }).document
    const frame = fakeFrame({
      contentDocument: frameDocument,
      box: { x: 100, y: 100, width: 150, height: 100 },
      border: 1,
    })
    const { document } = fakePageDocument({ elements: [frame] })

    // The content box starts at 101, 101 and ends at 249, 199, so the embed starts at 151, 111 and is clipped at 249.
    expect(await remoteContentOf(document)).toEqual(
      foundAnswer(item('embed.example.com', { x: 151, y: 111, width: 98, height: 30 })),
    )
  })

  it("skip the top document's origin inside a same-origin frame, and never take such a frame as a box", async () => {
    const frameDocument = fakePageDocument({ elements: [fakeImg({ src: `${storybookOrigin}/a.png` })] }).document
    const frame = fakeFrame({ contentDocument: frameDocument, src: `${storybookOrigin}/frame.html` })
    const { document } = fakePageDocument({ elements: [frame] })

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })
})

describe('responses a service worker mocked', () => {
  it('are never probed for in a document no service worker controls, which creates no canvas', async () => {
    const page = fakePageDocument({
      elements: [
        fakeImg({ src: 'https://a.example.com/a.png', mocked: true }),
        background('url("https://b.example.com/b.png")'),
      ],
      responses: { 'https://b.example.com/b.png': 'mocked' },
    })

    expect(await remoteContentOf(page.document)).toEqual(foundAnswer(item('a.example.com'), item('b.example.com')))
    expect(page.canvases()).toBe(0)
    expect(page.loads()).toEqual([])
  })

  it('are dropped, while passed-through ones count, a CSS image loaded by a fresh Image', async () => {
    const page = fakePageDocument({
      elements: [background('url("https://a.example.com/a.png")'), background('url("https://b.example.com/b.png")')],
      controlled: true,
      responses: { 'https://a.example.com/a.png': 'passthrough', 'https://b.example.com/b.png': 'mocked' },
    })

    expect(await remoteContentOf(page.document)).toEqual(foundAnswer(item('a.example.com')))
    expect(page.loads()).toEqual(['https://a.example.com/a.png', 'https://b.example.com/b.png'])
    expect(page.canvases()).toBe(2)
  })

  it('are told apart on a complete <img> without crossorigin by drawing it as it is', async () => {
    const page = fakePageDocument({
      elements: [
        fakeImg({ src: 'https://a.example.com/a.png' }),
        fakeImg({ src: 'https://b.example.com/b.png', mocked: true }),
      ],
      controlled: true,
    })

    expect(await remoteContentOf(page.document)).toEqual(foundAnswer(item('a.example.com')))
    expect(page.loads()).toEqual([])
    expect(page.canvases()).toBe(2)
  })

  it('are told apart by a fresh Image for <img crossorigin>, an incomplete <img>, an SVG image, a poster', async () => {
    const withCrossorigin = 'https://a.example.com/a.png'
    const incomplete = 'https://b.example.com/b.png'
    const svgImage = 'https://c.example.com/c.png'
    const poster = 'https://d.example.com/d.jpg'
    const urls = [withCrossorigin, incomplete, svgImage, poster]
    const page = fakePageDocument({
      elements: [
        fakeImg({ src: withCrossorigin, crossorigin: 'anonymous' }),
        fakeImg({ src: incomplete, complete: false }),
        fakeSvgImage({ href: svgImage }),
        fakeElement('video', { properties: { poster } }),
      ],
      controlled: true,
      responses: Object.fromEntries(urls.map((url) => [url, 'passthrough'])),
    })

    expect(await remoteContentOf(page.document)).toEqual(
      foundAnswer(item('a.example.com'), item('b.example.com'), item('c.example.com'), item('d.example.com')),
    )
    expect(page.loads()).toEqual(urls)
  })

  it('count an image that fails to load as remote', async () => {
    const page = fakePageDocument({
      elements: [background('url("https://a.example.com/a.png")')],
      controlled: true,
      responses: { 'https://a.example.com/a.png': 'fails' },
    })

    expect(await remoteContentOf(page.document)).toEqual(foundAnswer(item('a.example.com')))
    expect(page.canvases()).toBe(0)
  })

  it('are probed for once per URL', async () => {
    const url = 'https://a.example.com/a.png'
    const page = fakePageDocument({
      elements: [background(`url("${url}")`), fakeImg({ src: url, complete: false }), background(`url("${url}")`)],
      controlled: true,
      responses: { [url]: 'passthrough' },
    })

    expect(await remoteContentOf(page.document)).toEqual(
      foundAnswer(item('a.example.com'), item('a.example.com'), item('a.example.com')),
    )
    expect(page.loads()).toEqual([url])
    expect(page.canvases()).toBe(1)
  })

  it("are probed for by each document's own service worker, and a frame never is", async () => {
    const frameUrl = 'https://a.example.com/in-frame.png'
    const frame = fakePageDocument({
      elements: [background(`url("${frameUrl}")`)],
      controlled: true,
      responses: { [frameUrl]: 'mocked' },
    })
    const top = fakePageDocument({
      elements: [
        fakeFrame({ contentDocument: frame.document }),
        fakeFrame({ src: 'https://embed.example.com/', box: { x: 0, y: 0, width: 10, height: 10 } }),
      ],
      controlled: true,
    })

    expect(await remoteContentOf(top.document)).toEqual(
      foundAnswer(item('embed.example.com', { x: 0, y: 0, width: 10, height: 10 })),
    )
    expect(top.loads()).toEqual([])
    expect(top.canvases()).toBe(0)
    expect(frame.loads()).toEqual([frameUrl])
  })
})

describe('the time limit', () => {
  it('passing while an image is probed gives a timeout, and the timer is cleared', async () => {
    const page = fakePageDocument({
      elements: [background('url("https://a.example.com/a.png")')],
      controlled: true,
      responses: { 'https://a.example.com/a.png': 'stalls' },
    })
    const search = openSearch(page.document)
    const answer = search.find(1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await answer).toEqual({ outcome: 'timed-out' })
    expect(search.setTimer).toHaveBeenCalledTimes(1)
    expect(search.clearTimer).toHaveBeenCalledWith(search.setTimer.mock.results[0]?.value)
  })

  it("uses the browser's own timers, not those the story replaced, and clears its timer once it answers", async () => {
    const page = fakePageDocument({ elements: [fakeImg({ src: 'https://a.example.com/a.png' })] })
    const search = openSearch(page.document)

    search.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    expect(await search.find(1000)).toEqual(foundAnswer(item('a.example.com')))
    expect(search.setTimer).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(search.clearTimer).toHaveBeenCalledWith(search.setTimer.mock.results[0]?.value)
  })
})

describe('timers that throw', () => {
  it('give no remote content when the timer cannot be set, never throwing', async () => {
    const { document } = fakePageDocument({ elements: [fakeImg({ src: 'https://a.example.com/a.png' })] })
    const fail = (): never => {
      throw new Error('setTimeout is broken')
    }
    const search = openSearch(document, [], { setTimer: fail })

    expect(await search.find(1000)).toEqual(foundAnswer())
    expect(search.clearTimer).toHaveBeenCalledTimes(1)
  })

  it('still give what was found when the timer cannot be cleared', async () => {
    const { document } = fakePageDocument({ elements: [fakeImg({ src: 'https://a.example.com/a.png' })] })
    const fail = (): never => {
      throw new Error('clearTimeout is broken')
    }
    const search = openSearch(document, [], { clearTimer: fail })

    expect(await search.find(1000)).toEqual(foundAnswer(item('a.example.com')))
    expect(search.clearTimer).toHaveBeenCalledTimes(1)
  })
})

describe('elements that throw', () => {
  it('are skipped, and the rest are still searched', async () => {
    const fail = (): never => {
      throw new Error('unreadable')
    }
    const unstyled = fakeElement('div', { stylesThrow: true })
    const unmeasurable = fakeImg({ src: 'https://a.example.com/a.png' })
    const guarded = fakeFrame({ src: 'https://b.example.com/' })
    const found = fakeImg({ src: 'https://c.example.com/c.png' })

    Object.assign(unmeasurable, { getBoundingClientRect: fail })
    Object.defineProperty(guarded, 'contentDocument', { get: fail })

    const broken = { querySelectorAll: fail }
    const { document } = fakePageDocument({ elements: [unstyled, unmeasurable, guarded, found] })

    expect(await remoteContentOf(document, [broken])).toEqual(foundAnswer(item('c.example.com')))
  })

  it('include a document whose window cannot be read, which gives nothing', async () => {
    const document = {
      get defaultView(): never {
        throw new Error('unreadable')
      },
    }

    expect(await remoteContentOf(document)).toEqual(foundAnswer())
  })
})
