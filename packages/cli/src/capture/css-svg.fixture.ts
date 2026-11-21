import { vi } from 'vitest'

/**
 * The computed styles of a fake element, by pseudo-element: `''` for the element itself, `::before` or `::after`.
 * Each maps a CSS property to its computed value. A property not listed computes to an empty value.
 */
type FakeStyles = Partial<Record<'' | '::before' | '::after', Record<string, string>>>

/**
 * A fake element with computed styles, as a test sets it up and reads it back.
 */
export interface FakeStyledElement {
  /**
   * The element's tag name.
   */
  readonly localName: string
  /**
   * The element's computed styles, which a test can change as the page would.
   */
  styles: FakeStyles
  /**
   * The element's attributes.
   */
  readonly attributes: Map<string, string>
  /**
   * Gives an attribute's value, or `null` without one.
   */
  getAttribute: (name: string) => string | null
  /**
   * Sets an attribute.
   */
  setAttribute: (name: string, value: string) => void
}

/**
 * A stylesheet the fake `CSSStyleSheet` made.
 */
export interface FakeSheet {
  /**
   * The text `replaceSync` gave it, empty until then.
   */
  text: string
}

/**
 * How the server gives an SVG file to the fake `fetch`.
 */
export interface FakeSvgFile {
  /**
   * The file's text.
   */
  text: string
  /**
   * The response's status: 200 by default.
   */
  status?: number
}

/**
 * The SMIL animation elements the fake `DOMParser` finds, as self-closing tags.
 */
const smilTagPattern = /<(animate|animateMotion|animateTransform|set)((?:\s+[\w:-]+="[^"]*")*)\s*\/>/g

/**
 * An attribute in a tag.
 */
const attributePattern = /([\w:-]+)="([^"]*)"/g

/**
 * Builds a fake element with these computed styles.
 */
export function fakeStyledElement(styles: FakeStyles, localName = 'div'): FakeStyledElement {
  const attributes = new Map<string, string>()

  return {
    localName,
    styles,
    attributes,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value)
    },
  }
}

/**
 * A SMIL animation element the fake `DOMParser` found.
 */
class FakeSmilElement {
  /**
   * The element's tag name.
   */
  readonly localName: string

  /**
   * The element's attributes, in order.
   */
  readonly attributes: Map<string, string>

  /**
   * Builds an element with this tag name and these attributes.
   */
  constructor(localName: string, attributes: Map<string, string>) {
    this.localName = localName
    this.attributes = attributes
  }

  /**
   * Sets an attribute, adding it last when it's new.
   */
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  /**
   * Removes an attribute.
   */
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  /**
   * The element as a self-closing tag.
   */
  toString(): string {
    const attributes = Array.from(this.attributes, ([name, value]) => ` ${name}="${value}"`).join('')

    return `<${this.localName}${attributes}/>`
  }
}

/**
 * An SVG document the fake `DOMParser` gave: its markup, with each SMIL animation element, written as a self-closing
 * tag, found.
 */
class FakeSvgDocument {
  /**
   * The markup's parts between the animation elements.
   */
  private readonly between: string[]

  /**
   * The animation elements, each between two parts.
   */
  private readonly animations: FakeSmilElement[]

  /**
   * Whether the markup didn't parse: when it doesn't start with `<svg`.
   */
  private readonly parseError: boolean

  /**
   * Parses the markup.
   */
  constructor(markup: string) {
    this.parseError = !markup.startsWith('<svg')
    this.between = markup.split(smilTagPattern).filter((_part, index) => index % 3 === 0)
    this.animations = Array.from(
      markup.matchAll(smilTagPattern),
      ([, name, attributes]) =>
        new FakeSmilElement(
          name ?? '',
          new Map(
            Array.from((attributes ?? '').matchAll(attributePattern), ([, key, value]) => [key ?? '', value ?? '']),
          ),
        ),
    )
  }

  /**
   * Gives the animation elements for the end state's selector of them.
   */
  querySelectorAll(selector: string): FakeSmilElement[] {
    return selector.includes('animate') ? this.animations : []
  }

  /**
   * Gives a `<parsererror>` when the markup didn't parse, as Chromium's `DOMParser` adds one.
   */
  querySelector(selector: string): object | null {
    return selector === 'parsererror' && this.parseError ? {} : null
  }

  /**
   * The markup again, with each animation element as it is now.
   */
  serialize(): string {
    return this.between.map((part, index) => part + (this.animations[index]?.toString() ?? '')).join('')
  }
}

/**
 * Builds the page's globals that freezing SVG shown as CSS images uses: `getComputedStyle`, which reads a fake
 * element's styles and throws for anything else, as for an object that isn't an element, `DOMParser`, `XMLSerializer`
 * and `CSSStyleSheet`. `sheets` lists every sheet made.
 */
export function cssSvgGlobals(): { globals: Record<string, unknown>; sheets: FakeSheet[] } {
  const sheets: FakeSheet[] = []
  const globals = {
    getComputedStyle: (element: Partial<FakeStyledElement>, pseudoElement: string | null) => {
      const { styles } = element

      if (styles === undefined) {
        throw new TypeError('The object is not an element.')
      }

      return {
        getPropertyValue: (property: string) => styles[(pseudoElement ?? '') as keyof FakeStyles]?.[property] ?? '',
      }
    },
    DOMParser: class {
      parseFromString(markup: string): FakeSvgDocument {
        return new FakeSvgDocument(markup)
      }
    },
    XMLSerializer: class {
      serializeToString(document: FakeSvgDocument): string {
        return document.serialize()
      }
    },
    CSSStyleSheet: class {
      text = ''

      constructor() {
        sheets.push(this)
      }

      replaceSync(text: string): void {
        this.text = text
      }
    },
  }

  return { globals, sheets }
}

/**
 * Builds a fake of the browser's own `fetch`, as the page script kept it: it reads a `data:` URL as Node's does, and
 * gives each file in `files` by URL. A URL not listed fails, as a cross-origin one without CORS does.
 */
export function fakeFetch(files: Record<string, FakeSvgFile> = {}): (url: string) => Promise<Response> {
  return vi.fn(async (url: string) => {
    if (url.startsWith('data:')) {
      return await fetch(url)
    }

    const file = files[url]

    if (file === undefined) {
      throw new TypeError('Failed to fetch')
    }

    return new Response(file.text, { status: file.status ?? 200 })
  })
}

/**
 * The SVG markup a frozen SVG's data URL holds.
 */
export function markupOf(dataUrl: string): string {
  return decodeURIComponent(dataUrl.slice('data:image/svg+xml,'.length).split('#')[0] ?? '')
}
