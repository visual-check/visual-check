import { describe, expect, it, vi } from 'vitest'
import { forceStates, pageRewriterOf } from './force-states.js'
import type { ForcedState } from './forced-states.js'
import { type FakeElement, type FakePage, type FakeRoot, fakePage } from './page.fixture.js'
import { type FakeCSSStyleSheet, fakeStyleRule, selectorTextsOf } from './style-sheet.fixture.js'

/**
 * Only hover.
 */
const hover: ReadonlySet<ForcedState> = new Set(['hover'])

/**
 * `.btn:hover` with its light twin.
 */
const lightTwin = '.btn:hover, .btn:is(.visual-check-hover *)'

/**
 * `.btn:hover` with its light and host twins.
 */
const hostTwin = '.btn:hover, .btn:is(.visual-check-hover *), :host(:where(.visual-check-hover)) .btn'

/**
 * A sheet's selectors.
 */
function selectorsOf(sheet: FakeCSSStyleSheet | null): string[] {
  return selectorTextsOf(sheet as unknown as CSSStyleSheet)
}

/**
 * A new `<style>` holding `.btn:hover`.
 */
function buttonStyle(page: FakePage): FakeElement {
  return page.style([fakeStyleRule('.btn:hover')])
}

/**
 * A new constructed sheet holding `.btn:hover`.
 */
function buttonSheet(page: FakePage): FakeCSSStyleSheet {
  return page.sheet([fakeStyleRule('.btn:hover')])
}

/**
 * Assigns `adoptedStyleSheets` through the root's prototype, as a page would.
 */
function adopt(root: FakeRoot, sheets: FakeCSSStyleSheet[]): void {
  Object.assign(root, { adoptedStyleSheets: sheets })
}

/**
 * A page and its rewriter, forcing hover, and the stop function.
 */
function forcingHover(page = fakePage()) {
  const rewriter = pageRewriterOf(page.globals)

  return { page, rewriter, stop: rewriter.force(hover) }
}

/**
 * A page with a `<style>` holding `.btn:hover` in the document.
 */
function pageWithStyle() {
  const page = fakePage()
  const style = buttonStyle(page)

  page.append(page.document, style)

  return { page, style }
}

describe('starting and stopping', () => {
  it('touches nothing in the page until the first force', () => {
    const page = fakePage()
    const prototypes = [page.globals.Element.prototype, page.CSSStyleSheet.prototype, page.CSSGroupingRule.prototype]
    const before = prototypes.map((prototype) => ({ ...Object.getOwnPropertyDescriptors(prototype) }))
    const roots = [page.globals.Document.prototype, page.globals.ShadowRoot.prototype]
    const adopted = roots.map((prototype) => Object.getOwnPropertyDescriptor(prototype, 'adoptedStyleSheets'))

    pageRewriterOf(page.globals)

    expect(prototypes.map((prototype) => ({ ...Object.getOwnPropertyDescriptors(prototype) }))).toEqual(before)
    expect(roots.map((prototype) => Object.getOwnPropertyDescriptor(prototype, 'adoptedStyleSheets'))).toEqual(adopted)
    expect(page.observers).toEqual([])
  })

  it("rewrites the document's <style>, <link> and adopted sheets in document scope", () => {
    const page = fakePage()
    const style = buttonStyle(page)
    const link = page.element('link')
    const adopted = buttonSheet(page)

    link.sheet = buttonSheet(page)
    page.append(page.document, style, link)
    adopt(page.document, [adopted])
    forcingHover(page)

    expect([style.sheet, link.sheet, adopted].map(selectorsOf)).toEqual([[lightTwin], [lightTwin], [lightTwin]])
  })

  it("rewrites open shadow roots' <style> and adopted sheets in shadow-root scope, nested roots included", () => {
    const page = fakePage()
    const outer = page.host()
    const inner = page.host()
    const style = buttonStyle(page)
    const adopted = buttonSheet(page)

    page.append(page.document, outer.host)
    page.append(outer.root, inner.host)
    page.append(inner.root, style)
    adopt(outer.root, [adopted])
    forcingHover(page)

    expect([style.sheet, adopted].map(selectorsOf)).toEqual([[hostTwin], [hostTwin]])
  })

  it('rewrites again for a new state, and does no full pass for states already forced', () => {
    const page = fakePage()
    const style = page.style([fakeStyleRule('.btn:hover'), fakeStyleRule('.btn:focus')])

    page.append(page.document, style)

    const { rewriter } = forcingHover(page)
    const hovered = style.sheet?.cssRules[0] as ReturnType<typeof fakeStyleRule>

    rewriter.force(hover)
    expect(hovered.selectorTextSets).toBe(1)
    expect(selectorsOf(style.sheet)[1]).toBe('.btn:focus')

    rewriter.force(new Set(['focus']))
    expect(selectorsOf(style.sheet)[1]).toBe('.btn:focus, .btn:is(.visual-check-focus *)')
  })

  it('gives rules in existing shadow roots host twins for a new state', () => {
    const page = fakePage()
    const { host, root } = page.host()
    const style = page.style([fakeStyleRule('.btn:focus')])

    page.append(page.document, host)
    page.append(root, style)
    forcingHover(page).rewriter.force(new Set(['focus']))

    expect(selectorsOf(style.sheet)).toEqual([
      '.btn:focus, .btn:is(.visual-check-focus *), :host(:where(.visual-check-focus)) .btn',
    ])
  })

  it('stops once, after the last request: observers disconnected, listeners removed, later rules left, twins kept', () => {
    const { page, style } = pageWithStyle()
    const { host, root } = page.host()

    page.append(page.document, host)

    const { rewriter, stop } = forcingHover(page)
    const stopFocus = rewriter.force(new Set(['focus']))

    stop()
    stop()
    expect(page.observers.map((observer) => observer.disconnected)).toEqual([false])

    stopFocus()
    expect(page.observers.map((observer) => observer.disconnected)).toEqual([true])
    expect([page.document.listeners, root.listeners]).toEqual([[], []])

    style.sheet?.insertRule('.link:hover { color: blue }', 1)
    expect(selectorsOf(style.sheet)).toEqual([lightTwin, '.link:hover'])
  })

  it('is inert after the last stop: attachShadow and adoptedStyleSheets change nothing', () => {
    const { page, stop } = forcingHover()
    const sheet = buttonSheet(page)

    stop()

    const { root } = page.host()

    adopt(page.document, [sheet])
    adopt(root, [sheet])

    expect(page.observers[0]?.observed).toEqual([])
    expect(root.listeners).toEqual([])
    expect(selectorsOf(sheet)).toEqual(['.btn:hover'])
  })

  it('registers on the next force a closed root attached after the hooks, while inactive', () => {
    const page = fakePage()
    const wrapper = page.element('div', 'visual-check-hover')
    const rewriter = pageRewriterOf(page.globals)

    rewriter.force(hover)()

    const { host, root } = page.host('closed')
    const style = buttonStyle(page)

    page.append(page.document, wrapper)
    page.append(wrapper, host)
    page.append(root, style)
    rewriter.force(hover)

    expect(selectorsOf(style.sheet)).toEqual([hostTwin])
    expect([...host.classList]).toEqual(['visual-check-hover'])
  })

  it('observes the document for children, text and class changes', () => {
    const { page } = forcingHover()

    expect(page.observers[0]?.observed).toEqual([
      {
        target: page.document,
        options: { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] },
      },
    ])
  })
})

describe('styles added or changed later', () => {
  it('rewrites a <style> added later, and a <style> whose text changed into a new sheet', () => {
    const { page } = forcingHover()
    const style = buttonStyle(page)

    page.append(page.document, style)
    expect(selectorsOf(style.sheet)).toEqual([lightTwin])

    style.sheet = buttonSheet(page)
    page.deliver({ type: 'characterData', target: style, addedNodes: [] })
    expect(selectorsOf(style.sheet)).toEqual([lightTwin])
  })

  it.each([
    ['a sheet', (_page: FakePage, style: FakeElement) => style.sheet as FakeCSSStyleSheet],
    [
      'a grouping rule',
      (page: FakePage, style: FakeElement) => {
        const media = new page.CSSGroupingRule(4, [])

        media.parentStyleSheet = style.sheet as unknown as CSSStyleSheet
        style.sheet?.cssRules.push(media as unknown as CSSRule)

        return media
      },
    ],
  ])('rewrites a rule inserted into %s before insertRule returns', (_target, targetOf) => {
    const { page, style } = pageWithStyle()
    const target = targetOf(page, style)

    forcingHover(page)

    expect(target.insertRule('.btn:hover { color: blue }', 0)).toBe(0)
    expect((target.cssRules[0] as CSSStyleRule).selectorText).toBe(lightTwin)
  })

  it('leaves a rule inserted into a constructed sheet alone until the sheet is adopted', () => {
    const { page } = forcingHover()
    const sheet = page.sheet([])

    sheet.insertRule('.btn:hover { color: blue }')
    expect(selectorsOf(sheet)).toEqual(['.btn:hover'])

    adopt(page.document, [sheet])
    expect(selectorsOf(sheet)).toEqual([lightTwin])

    sheet.insertRule('.link:hover { color: blue }')
    expect(selectorsOf(sheet)[0]).toBe('.link:hover, .link:is(.visual-check-hover *)')
  })

  it('rewrites a sheet after replaceSync, and after replace once its promise resolves', async () => {
    const { page } = forcingHover()
    const sheet = page.sheet([])

    adopt(page.document, [sheet])

    sheet.replaceSync('.btn:hover { color: blue }')
    expect(selectorsOf(sheet)).toEqual([lightTwin])

    const replaced = sheet.replace('.link:hover { color: green }')

    expect(selectorsOf(sheet)).toEqual([lightTwin])
    expect(await replaced).toBe(sheet)
    expect(selectorsOf(sheet)).toEqual(['.link:hover, .link:is(.visual-check-hover *)'])
  })

  it('lets a rejected replace reach the caller', async () => {
    const { page } = forcingHover()
    const sheet = page.sheet([])

    adopt(page.document, [sheet])

    await expect(sheet.replace('not a rule')).rejects.toThrow(SyntaxError)
    expect(page.warn).not.toHaveBeenCalled()
  })

  it('rewrites a sheet pushed onto adoptedStyleSheets on the next change to the DOM', () => {
    const { page } = forcingHover()
    const { host, root } = page.host()
    const sheet = buttonSheet(page)

    page.append(page.document, host)
    page.document.adopted.push(sheet)
    page.append(root, page.element('div'))

    expect(selectorsOf(sheet)).toEqual([lightTwin])
  })

  it.each([
    ['the document', (page: FakePage) => page.document, lightTwin],
    ['a shadow root', (page: FakePage) => page.host('closed').root, hostTwin],
  ])('rewrites sheets assigned to adoptedStyleSheets on %s in its scope', (_root, rootOf, expected) => {
    const { page } = forcingHover()
    const sheet = buttonSheet(page)

    adopt(rootOf(page), [sheet])

    expect(selectorsOf(sheet)).toEqual([expected])
  })

  it.each(['open', 'closed'] as const)(
    'rewrites the later <style> children and adopted sheets of a %s shadow root attached after force',
    (mode) => {
      const { page } = forcingHover()
      const { host, root } = page.host(mode)
      const style = buttonStyle(page)
      const sheet = buttonSheet(page)

      page.append(page.document, host)
      page.append(root, style)
      adopt(root, [sheet])

      expect([style.sheet, sheet].map(selectorsOf)).toEqual([[hostTwin], [hostTwin]])
    },
  )

  it('rewrites a <link> that loads after force, in its root', () => {
    const { page } = forcingHover()
    const { host, root } = page.host()
    const link = page.element('link')
    const sheet = buttonSheet(page)

    page.append(page.document, host)
    page.append(root, link)
    page.load(link, sheet)

    expect(selectorsOf(sheet)).toEqual([hostTwin])
  })

  it('warns once about a cross-origin <link> and still rewrites other sheets', () => {
    const { page, style } = pageWithStyle()
    const link = page.element('link')

    link.sheet = page.sheet([], { href: 'https://cdn.example/a.css', crossOrigin: true })
    page.append(page.document, link)

    const { rewriter } = forcingHover(page)

    rewriter.force(new Set(['focus']))

    expect(page.warn.mock.calls).toEqual([
      [
        'visual-check: can\'t force states in the stylesheet https://cdn.example/a.css: it\'s cross-origin without CORS. Load it with crossorigin="anonymous" from a server that sends Access-Control-Allow-Origin.',
      ],
    ])
    expect(selectorsOf(style.sheet)[0]).toContain(':is(.visual-check-hover *)')
  })
})

describe('shadow hosts', () => {
  /**
   * A page with a `visual-check-hover` wrapper holding a host, which holds another host, forcing hover.
   */
  function nestedHosts() {
    const page = fakePage()
    const wrapper = page.element('div', 'visual-check-hover')
    const outer = page.host()

    page.append(page.document, wrapper)
    page.append(wrapper, outer.host)

    const forcing = forcingHover(page)
    // Attached while disconnected, as in a custom element's constructor.
    const inner = page.host('closed', 'own')

    page.append(outer.root, inner.host)

    return { ...forcing, wrapper, outer: outer.host, inner: inner.host }
  }

  it('gives a host inside a wrapper, directly or through another host, the wrapper state class', () => {
    const { outer, inner } = nestedHosts()

    expect([[...outer.classList], [...inner.classList]]).toEqual([
      ['visual-check-hover'],
      ['own', 'visual-check-hover'],
    ])
  })

  it('takes the class off hosts when the wrapper loses it', () => {
    const { page, wrapper, outer, inner } = nestedHosts()

    page.toggleClass(wrapper, 'visual-check-hover', false)

    expect([[...outer.classList], [...inner.classList]]).toEqual([[], ['own']])
  })

  it('takes the class off hosts on the last stop, and never removes a class a host had on its own', () => {
    const page = fakePage()
    const wrapper = page.element('div', 'visual-check-hover')
    const own = page.host('open', 'visual-check-hover')
    const added = page.host()

    page.append(page.document, wrapper)
    page.append(wrapper, own.host, added.host)
    forcingHover(page).stop()

    expect([[...own.host.classList], [...added.host.classList]]).toEqual([['visual-check-hover'], []])
  })
})

describe('hooks', () => {
  it('call the earlier implementation with the same arguments and return its result', () => {
    const page = fakePage()
    const attachShadow = vi.spyOn(page.globals.Element.prototype, 'attachShadow')
    const insertRule = vi.spyOn(page.CSSStyleSheet.prototype, 'insertRule')

    forcingHover(page)

    const element = page.element('div') as unknown as Element
    const root = element.attachShadow({ mode: 'closed' })
    const sheet = page.sheet([])

    expect(attachShadow.mock.calls).toEqual([[{ mode: 'closed' }]])
    expect(attachShadow.mock.results[0]?.value).toBe(root)
    expect(sheet.insertRule('.a { color: red }', 0)).toBe(0)
    expect(insertRule.mock.calls).toEqual([['.a { color: red }', 0]])
  })

  it('still chain under a hook installed after them', () => {
    const { page, style } = pageWithStyle()

    forcingHover(page)

    const ours = page.CSSStyleSheet.prototype.insertRule
    const theirs = vi.fn(function (this: FakeCSSStyleSheet, text: string, index?: number) {
      return ours.call(this, text, index)
    })

    page.CSSStyleSheet.prototype.insertRule = theirs
    style.sheet?.insertRule('.link:hover { color: blue }', 1)

    expect(theirs).toHaveBeenCalledOnce()
    expect(selectorsOf(style.sheet)[1]).toBe('.link:hover, .link:is(.visual-check-hover *)')
  })
})

describe('forceStates', () => {
  it('throws for a state visual-check does not force', () => {
    expect(() => forceStates(['visited' as ForcedState])).toThrow(
      'visual-check: forceStates can\'t force "visited". The states it forces are hover, active, focus-visible, focus-within and focus.',
    )
  })

  it.each([[[]], [['hover']]] as const)('returns a function that does nothing for %j without a DOM', (states) => {
    const stop = forceStates(states)

    expect(stop()).toBeUndefined()
  })
})
