/**
 * A fake media element, as a test sets it up and reads it back: a video, an inline SVG or an image.
 */
export interface FakeMedia {
  /**
   * The element's tag name: `video`, `svg` or `img`.
   */
  readonly localName: string
  /**
   * What was done to the element, in order, such as `pause` or `srcset = …`.
   */
  readonly actions: string[]
  /**
   * Adds a listener for the element's events of `type`, as page logic does, removed once it ran when `options` says
   * `once`.
   */
  addEventListener: (type: string, listener: () => void, options?: { once?: boolean }) => void
}

/**
 * How the server gives an image file a fake document loads. Each part has a default, given with it.
 */
export interface FakeImageFile {
  /**
   * Whether the file comes: it `loads` by default, `fails` with an error, or `stalls`, never coming.
   */
  arrival?: 'loads' | 'fails' | 'stalls'
  /**
   * Where the file comes from: the page's own origin by default, or another origin, with CORS or without.
   */
  origin?: 'same-origin' | 'cross-origin-with-cors' | 'cross-origin-without-cors'
  /**
   * Whether the server refuses a request that sends a referrer, as a hotlink-protected one does: no by default.
   */
  hotlinkProtected?: boolean
  /**
   * The file's width, in pixels: 40 by default.
   */
  width?: number
  /**
   * The file's height, in pixels: 30 by default.
   */
  height?: number
}

/**
 * How long a fake image file takes to come, in ms.
 */
const fileArrivalMs = 10

/**
 * The width of a fake image file, in pixels, unless the test says otherwise.
 */
const defaultWidth = 40

/**
 * The height of a fake image file, in pixels, unless the test says otherwise.
 */
const defaultHeight = 30

/**
 * A listener a fake element keeps.
 */
interface FakeListener {
  /**
   * The event it listens for.
   */
  type: string
  /**
   * Whether it's removed once it ran.
   */
  once: boolean
  /**
   * Runs when the event comes.
   */
  listener: () => void
}

/**
 * A fake of the page's `EventTarget`, enough for the events the end state and a test's page logic listen for.
 */
class FakeEventTarget {
  /**
   * The listeners added, in order.
   */
  private listeners: FakeListener[] = []

  /**
   * Adds a listener for `type`, removed once it ran when `options` says `once`.
   */
  addEventListener(type: string, listener: () => void, options: { once?: boolean } = {}): void {
    this.listeners.push({ type, once: options.once === true, listener })
  }

  /**
   * Fires an event of `type`, running its listeners.
   */
  protected dispatch(type: string): void {
    const listening = this.listeners.filter((entry) => entry.type === type)

    this.listeners = this.listeners.filter((entry) => entry.type !== type || !entry.once)

    for (const entry of listening) {
      entry.listener()
    }
  }
}

/**
 * How a fake video starts. Each part has a default, given with it.
 */
interface FakeVideoOptions {
  /**
   * The video's ready state: 4, enough loaded to play through, by default. 0 means it has loaded nothing.
   */
  readyState?: number
  /**
   * Whether the video is paused: no, it's playing, by default.
   */
  paused?: boolean
  /**
   * Where the video is, in seconds: 1.5 by default.
   */
  currentTime?: number
  /**
   * Whether the video is seeking: no by default.
   */
  seeking?: boolean
  /**
   * Whether the video has a seekable range, so setting `currentTime` starts a seek: yes by default. A live stream has
   * none.
   */
  seekable?: boolean
  /**
   * How long a seek takes before `seeked` fires, in ms: 20 by default. `null` makes a seek that never ends.
   */
  seekMs?: number | null
}

/**
 * A fake of the page's `HTMLVideoElement`, recording what's done to it.
 */
class FakeVideo extends FakeEventTarget implements FakeMedia {
  /**
   * The element's tag name.
   */
  readonly localName = 'video'

  /**
   * What was done to the video, in order: `pause`, and each assignment of `autoplay` and `currentTime`.
   */
  readonly actions: string[] = []

  /**
   * The video's ready state.
   */
  readonly readyState: number

  /**
   * Whether setting `currentTime` starts a seek.
   */
  private readonly seekable: boolean

  /**
   * How long a seek takes, in ms, `null` when it never ends.
   */
  private readonly seekMs: number | null

  /**
   * Whether the video is paused.
   */
  private isPaused: boolean

  /**
   * Whether the video is seeking.
   */
  private isSeeking: boolean

  /**
   * Whether the video starts playing on its own.
   */
  private playsOnItsOwn = true

  /**
   * Where the video is, in seconds.
   */
  private time: number

  /**
   * Builds a video that starts as `options` says.
   */
  constructor({
    readyState = 4,
    paused = false,
    currentTime = 1.5,
    seeking = false,
    seekable = true,
    seekMs = 20,
  }: FakeVideoOptions) {
    super()
    this.readyState = readyState
    this.isPaused = paused
    this.time = currentTime
    this.isSeeking = seeking
    this.seekable = seekable
    this.seekMs = seekMs
  }

  /**
   * Whether the video is paused.
   */
  get paused(): boolean {
    return this.isPaused
  }

  /**
   * Whether the video is seeking.
   */
  get seeking(): boolean {
    return this.isSeeking
  }

  /**
   * Whether the video starts playing on its own.
   */
  get autoplay(): boolean {
    return this.playsOnItsOwn
  }

  /**
   * Sets whether the video starts playing on its own, recording the assignment.
   */
  set autoplay(value: boolean) {
    this.actions.push(`autoplay = ${value}`)
    this.playsOnItsOwn = value
  }

  /**
   * Where the video is, in seconds.
   */
  get currentTime(): number {
    return this.time
  }

  /**
   * Records the assignment and, when the video has a seekable range, starts a seek: `seeking` turns true at once, as
   * in Chromium, and `seeked` fires once the seek ends.
   */
  set currentTime(time: number) {
    this.actions.push(`currentTime = ${time}`)

    if (!this.seekable) {
      return
    }

    this.time = time
    this.isSeeking = true

    if (this.seekMs !== null) {
      setTimeout(() => {
        this.isSeeking = false
        this.dispatch('seeked')
      }, this.seekMs)
    }
  }

  /**
   * Pauses the video, firing `pause` when it was playing. The browser fires it a task later; here it fires at once,
   * which page logic that reacts at an animation frame can't tell apart.
   */
  pause(): void {
    const wasPlaying = !this.isPaused

    this.actions.push('pause')
    this.isPaused = true

    if (wasPlaying) {
      this.dispatch('pause')
    }
  }
}

/**
 * How a fake inline SVG starts. Each part has a default, given with it.
 */
interface FakeSvgOptions {
  /**
   * The `svg` element it's nested in: none by default, so it's the outermost one.
   */
  nestedIn?: FakeMedia
  /**
   * The SMIL animation element it holds, such as `animateTransform`: an `animate` by default. `null` makes a static
   * SVG, such as an icon.
   */
  holds?: string | null
}

/**
 * A fake of the page's `SVGSVGElement`, recording what's done to its animations.
 */
class FakeSvg extends FakeEventTarget implements FakeMedia {
  /**
   * The element's tag name.
   */
  readonly localName = 'svg'

  /**
   * What was done to the SVG's animations, in order: `pauseAnimations`, and each `setCurrentTime` with its time.
   */
  readonly actions: string[] = []

  /**
   * The nearest `svg` element it's nested in, `null` for the outermost one.
   */
  readonly ownerSVGElement: FakeMedia | null

  /**
   * The SMIL animation element it holds, `null` for none.
   */
  private readonly holds: string | null

  /**
   * Builds an SVG that starts as `options` says.
   */
  constructor({ nestedIn, holds = 'animate' }: FakeSvgOptions) {
    super()
    this.ownerSVGElement = nestedIn ?? null
    this.holds = holds
  }

  /**
   * Gives the SMIL animation element the SVG holds when the selector list names it, else `null`.
   */
  querySelector(selectors: string): object | null {
    const names = selectors.split(',').map((name) => name.trim())

    return this.holds !== null && names.includes(this.holds) ? { localName: this.holds } : null
  }

  /**
   * Pauses the SVG's animations.
   */
  pauseAnimations(): void {
    this.actions.push('pauseAnimations')
  }

  /**
   * Seeks the SVG's animations to `seconds`.
   */
  setCurrentTime(seconds: number): void {
    this.actions.push(`setCurrentTime ${seconds}`)
  }
}

/**
 * How a fake image starts. Each part has a default, given with it.
 */
interface FakeImageOptions {
  /**
   * The image's `src`, as the browser resolves it.
   */
  src: string
  /**
   * The source the browser picked and shows, from the `srcset` or `src`: `src` by default, empty when it picked none
   * yet.
   */
  currentSrc?: string
  /**
   * The image's natural width, in CSS pixels, at the density of the source it picked: 40, a file's, by default.
   */
  naturalWidth?: number
  /**
   * The image's `crossorigin`, such as `anonymous`: none by default.
   */
  crossOrigin?: string
  /**
   * The image's referrer policy, such as `no-referrer`: none by default.
   */
  referrerPolicy?: string
  /**
   * Whether a `<source>` of the image's `<picture>` picks what it shows, so its own `srcset` doesn't: no by default.
   */
  pickedBySource?: boolean
}

/**
 * A fake of the page's `HTMLImageElement`, recording what's done to it.
 */
class FakeImage extends FakeEventTarget implements FakeMedia {
  /**
   * The element's tag name.
   */
  readonly localName = 'img'

  /**
   * What was done to the image, in order: each assignment of `srcset`, each `removeAttribute` with its name, and
   * `decode`.
   */
  readonly actions: string[] = []

  /**
   * The image's `src`.
   */
  readonly src: string

  /**
   * The image's natural width, in CSS pixels.
   */
  readonly naturalWidth: number

  /**
   * The image's `crossorigin`, `null` without one.
   */
  readonly crossOrigin: string | null

  /**
   * The image's referrer policy, empty without one.
   */
  readonly referrerPolicy: string

  /**
   * Whether a `<source>` picks what the image shows.
   */
  private readonly pickedBySource: boolean

  /**
   * The source the image shows.
   */
  private shown: string

  /**
   * The image's `srcset`.
   */
  private candidates = ''

  /**
   * Builds an image that starts as `options` says.
   */
  constructor({
    src,
    currentSrc = src,
    naturalWidth = defaultWidth,
    crossOrigin,
    referrerPolicy = '',
    pickedBySource = false,
  }: FakeImageOptions) {
    super()
    this.src = src
    this.shown = currentSrc
    this.naturalWidth = naturalWidth
    this.crossOrigin = crossOrigin ?? null
    this.referrerPolicy = referrerPolicy
    this.pickedBySource = pickedBySource
  }

  /**
   * The source the image shows.
   */
  get currentSrc(): string {
    return this.shown
  }

  /**
   * The image's `srcset`.
   */
  get srcset(): string {
    return this.candidates
  }

  /**
   * Sets the image's `srcset` to one candidate, a URL and its density, recording the assignment. The image then shows
   * that URL and fires `load`, unless a `<source>` picks what it shows. The browser fires it once the URL loaded; here
   * it fires at once, which page logic that reacts at an animation frame can't tell apart.
   */
  set srcset(candidates: string) {
    this.actions.push(`srcset = ${candidates}`)
    this.candidates = candidates

    if (!this.pickedBySource) {
      this.shown = candidates.slice(0, candidates.lastIndexOf(' '))
      this.dispatch('load')
    }
  }

  /**
   * Removes the attribute `name`.
   */
  removeAttribute(name: string): void {
    this.actions.push(`removeAttribute ${name}`)
  }

  /**
   * Decodes the image.
   */
  decode(): Promise<void> {
    this.actions.push('decode')

    return Promise.resolve()
  }
}

/**
 * A fake of an image a script creates with `document.createElement('img')`, which loads its `src` as the server gives
 * it.
 */
class FakeImageCopy extends FakeEventTarget {
  /**
   * The image's `crossorigin`, `null` without one. It must be set before `src` to take effect.
   */
  crossOrigin: string | null = null

  /**
   * The image's referrer policy, empty without one. It must be set before `src` to take effect.
   */
  referrerPolicy = ''

  /**
   * The image's natural width, in pixels: 0 until it loaded.
   */
  naturalWidth = 0

  /**
   * The image's natural height, in pixels: 0 until it loaded.
   */
  naturalHeight = 0

  /**
   * Whether drawing the image on a canvas taints it: when it came from another origin without CORS.
   */
  tainted = false

  /**
   * The image's `src`.
   */
  private source = ''

  /**
   * How the server gives each image file, by URL.
   */
  private readonly files: Record<string, FakeImageFile>

  /**
   * Builds an image that loads files as `files` says.
   */
  constructor(files: Record<string, FakeImageFile>) {
    super()
    this.files = files
  }

  /**
   * The image's `src`.
   */
  get src(): string {
    return this.source
  }

  /**
   * Starts loading `source`, firing `load` or `error` once the file came, or nothing when it stalls. A CORS request,
   * made when `crossOrigin` is set, fails for a file served without CORS. A request that sends a referrer fails for a
   * hotlink-protected file.
   */
  set src(source: string) {
    this.source = source

    const {
      arrival = 'loads',
      origin = 'same-origin',
      hotlinkProtected = false,
      width = defaultWidth,
      height = defaultHeight,
    } = this.files[source] ?? {}
    const corsRequest = this.crossOrigin !== null
    const refused =
      (corsRequest && origin === 'cross-origin-without-cors') ||
      (hotlinkProtected && this.referrerPolicy !== 'no-referrer')

    if (arrival === 'stalls') {
      return
    }

    setTimeout(() => {
      if (arrival === 'fails' || refused) {
        this.dispatch('error')

        return
      }

      this.naturalWidth = width
      this.naturalHeight = height
      this.tainted = origin !== 'same-origin' && !corsRequest
      this.dispatch('load')
    }, fileArrivalMs)
  }
}

/**
 * A fake of the page's `HTMLCanvasElement`, whose data URL tells which image was drawn on it, and at what size.
 */
class FakeCanvas {
  /**
   * The canvas's width, in pixels.
   */
  width = 300

  /**
   * The canvas's height, in pixels.
   */
  height = 150

  /**
   * The image last drawn on the canvas.
   */
  private drawn: FakeImageCopy | undefined

  /**
   * Gives the canvas's 2D context, which draws an image, or `null` for another kind.
   */
  getContext(kind: string): { drawImage: (image: FakeImageCopy) => void } | null {
    if (kind !== '2d') {
      return null
    }

    return {
      drawImage: (image) => {
        this.drawn = image
      },
    }
  }

  /**
   * Gives the canvas as a data URL, as `firstFrameUrl` builds it. Throws when a drawn image tainted it.
   */
  toDataURL(): string {
    if (this.drawn?.tainted === true) {
      throw new Error('SecurityError: Tainted canvases may not be exported.')
    }

    return firstFrameUrl(this.drawn?.src ?? '', this.width, this.height)
  }
}

/**
 * Builds the data URL a fake canvas gives once the image file at `source` was drawn on it at `width` × `height`, 40 ×
 * 30 by default. It holds no space, so it can stand in a `srcset`.
 */
export function firstFrameUrl(source: string, width = defaultWidth, height = defaultHeight): string {
  return `data:image/png,first-frame-${width}x${height}-of-${source}`
}

/**
 * Builds a fake video playing at 1.5 s on its own, that has loaded enough to play through and takes 20 ms to seek,
 * unless `options` says otherwise.
 */
export function fakeVideo(options: FakeVideoOptions = {}): FakeMedia {
  return new FakeVideo(options)
}

/**
 * Builds a fake inline SVG holding an `animate` element, the outermost one, unless `options` says otherwise.
 */
export function fakeSvg(options: FakeSvgOptions = {}): FakeMedia {
  return new FakeSvg(options)
}

/**
 * Builds a fake image showing `src` at 40 CSS pixels wide, without `crossorigin` or referrer policy, unless `options`
 * says otherwise.
 */
export function fakeImage(options: FakeImageOptions): FakeMedia {
  return new FakeImage(options)
}

/**
 * Builds a fake of the page's `document.createElement`, for the canvases and images a script creates. The images load
 * files as `files` says.
 */
export function fakeCreateElement(files: Record<string, FakeImageFile>): (localName: string) => object {
  return (localName) => (localName === 'canvas' ? new FakeCanvas() : new FakeImageCopy(files))
}
