import { describe, expect, it, vi } from 'vitest'
import type { ForcedState } from './forced-states.js'
import {
  fakeGroupingRule,
  fakeImportRule,
  fakeKeyframesRule,
  fakeStyleRule,
  fakeStyleSheet,
  selectorTextsOf,
} from './style-sheet.fixture.js'
import { styleSheetRewriterOf } from './style-sheet-rewrite.js'

/**
 * Only hover, listed.
 */
const hover: ReadonlySet<ForcedState> = new Set(['hover'])

/**
 * The light twin of `.btn:hover`'s selector list.
 */
const twinnedButton = '.btn:hover, .btn:is(.visual-check-hover *)'

/**
 * A rewriter and the warnings it gave.
 */
function rewriterWithWarnings() {
  const warn = vi.fn<(message: string) => void>()

  return { rewriter: styleSheetRewriterOf(warn), warn }
}

describe('rewriteSheet', () => {
  it('rewrites a rule in place, keeping the same object and declarations', () => {
    const rule = fakeStyleRule('.btn:hover')
    const sheet = fakeStyleSheet([rule])

    rewriterWithWarnings().rewriter.rewriteSheet(sheet, 'document', hover)

    expect(sheet.cssRules[0]).toBe(rule)
    expect(rule.selectorText).toBe(twinnedButton)
    expect(rule.style.cssText).toBe('color: red;')
  })

  it("keeps another rewriter's expando and still rewrites the rule", () => {
    const rule = Object.assign(fakeStyleRule('.btn:hover'), { __processed: true })

    rewriterWithWarnings().rewriter.rewriteSheet(fakeStyleSheet([rule]), 'document', hover)

    expect(rule.__processed).toBe(true)
    expect(rule.selectorText).toBe(twinnedButton)
  })

  it('rewrites grouping rules, nested style rules and imported sheets', () => {
    const imported = fakeStyleSheet([fakeStyleRule('.imported:hover')])
    const sheet = fakeStyleSheet([
      fakeGroupingRule([fakeStyleRule('.media:hover')]),
      fakeGroupingRule([fakeGroupingRule([fakeStyleRule('.layered:hover')], 18)], 12),
      fakeStyleRule('.card', { cssRules: [fakeStyleRule('&:hover')] }),
      fakeImportRule(imported),
      fakeImportRule(null),
    ])

    rewriterWithWarnings().rewriter.rewriteSheet(sheet, 'document', hover)

    expect(selectorTextsOf(sheet)).toEqual([
      '.media:hover, .media:is(.visual-check-hover *)',
      '.layered:hover, .layered:is(.visual-check-hover *)',
      '.card',
      '&:hover, &:is(.visual-check-hover *)',
    ])
    expect(selectorTextsOf(imported)).toEqual(['.imported:hover, .imported:is(.visual-check-hover *)'])
  })

  it('leaves keyframes, font-face and page rules alone', () => {
    const keyframes = fakeKeyframesRule()
    const fontFace = { type: 5, cssText: '@font-face {}' } as unknown as CSSRule
    const page = { type: 6, selectorText: ':hover' } as unknown as CSSRule

    rewriterWithWarnings().rewriter.rewriteSheet(fakeStyleSheet([keyframes, fontFace, page]), 'document', hover)

    expect(keyframes.cssRules[0]).toEqual({ type: 8, keyText: ':hover' })
    expect(fontFace).toEqual({ type: 5, cssText: '@font-face {}' })
    expect(page).toEqual({ type: 6, selectorText: ':hover' })
  })
})

describe('bookkeeping', () => {
  it('sets nothing on a second pass with the same states and scope', () => {
    const rule = fakeStyleRule('.btn:hover')
    const { rewriter } = rewriterWithWarnings()

    rewriter.rewriteSheet(fakeStyleSheet([rule]), 'document', hover)
    rewriter.rewriteRule(rule, 'document', hover)
    rewriter.rewriteSheet(fakeStyleSheet([rule]), 'document', hover)

    expect(rule.selectorTextSets).toBe(1)
  })

  it.each([
    [
      'a new state',
      'document',
      new Set<ForcedState>(['hover', 'focus']),
      '.btn:hover:focus, .btn:is(.visual-check-hover *):focus, .btn:is(.visual-check-hover *):is(.visual-check-focus *)',
    ],
    [
      'the other scope',
      'shadow-root',
      hover,
      '.btn:hover:focus, .btn:is(.visual-check-hover *):focus, :host(:where(.visual-check-hover)) .btn:focus',
    ],
  ] as const)('redoes the rule for %s', (_change, scope, states, expected) => {
    const rule = fakeStyleRule('.btn:hover:focus')
    const sheet = fakeStyleSheet([rule])
    const { rewriter } = rewriterWithWarnings()

    rewriter.rewriteSheet(sheet, 'document', hover)
    rewriter.rewriteSheet(sheet, scope, states)

    expect(rule.selectorTextSets).toBe(2)
    expect(rule.selectorText).toBe(expected)
  })

  it('walks the sheet again after forgetSheet', () => {
    const sheet = fakeStyleSheet([fakeStyleRule('.btn:hover')])
    const { rewriter } = rewriterWithWarnings()

    rewriter.rewriteSheet(sheet, 'document', hover)

    sheet.replaceSync('.link:hover { color: blue }')
    rewriter.rewriteSheet(sheet, 'document', hover)
    expect(selectorTextsOf(sheet)).toEqual(['.link:hover'])

    rewriter.forgetSheet(sheet)
    rewriter.rewriteSheet(sheet, 'document', hover)
    expect(selectorTextsOf(sheet)).toEqual(['.link:hover, .link:is(.visual-check-hover *)'])
  })

  it.each([[['document']], [['shadow-root']], [['document', 'shadow-root']], [[]]] as const)(
    'after passes in %j, scopesOf reports those scopes',
    (scopes) => {
      const sheet = fakeStyleSheet([fakeStyleRule('.btn:hover')])
      const { rewriter } = rewriterWithWarnings()

      for (const scope of scopes) {
        rewriter.rewriteSheet(sheet, scope, hover)
      }

      expect([...rewriter.scopesOf(sheet)]).toEqual(scopes)
    },
  )

  it('reports a scope passed in twice once', () => {
    const sheet = fakeStyleSheet([fakeStyleRule('.btn:hover')])
    const { rewriter } = rewriterWithWarnings()

    rewriter.rewriteSheet(sheet, 'document', hover)
    rewriter.rewriteSheet(sheet, 'document', new Set<ForcedState>(['focus']))

    expect([...rewriter.scopesOf(sheet)]).toEqual(['document'])
  })
})

describe('coexistence and warnings', () => {
  it('leaves one twin after the pseudo-states addon replaces the rule with insertRule and deleteRule', () => {
    const sheet = fakeStyleSheet([fakeStyleRule('.btn:hover')])
    const { rewriter } = rewriterWithWarnings()

    rewriter.rewriteSheet(sheet, 'document', hover)

    const rewritten = (sheet.cssRules[0] as CSSStyleRule).selectorText

    sheet.insertRule(`${rewritten}, .btn.pseudo-hover, .pseudo-hover-all .btn { color: red; }`, 1)
    sheet.deleteRule(0)
    rewriter.rewriteRule(sheet.cssRules[0] as CSSRule, 'document', hover)

    expect(selectorTextsOf(sheet)).toEqual([`${twinnedButton}, .btn.pseudo-hover, .pseudo-hover-all .btn`])
  })

  it('warns once about a cross-origin sheet, never counts it as rewritten, still rewrites other sheets and never throws', () => {
    const crossOrigin = fakeStyleSheet([], { href: 'https://cdn.example/a.css', crossOrigin: true })
    const other = fakeStyleSheet([fakeStyleRule('.btn:hover')])
    const { rewriter, warn } = rewriterWithWarnings()

    for (const states of [hover, new Set<ForcedState>(['focus'])]) {
      expect(() => rewriter.rewriteSheet(crossOrigin, 'document', states)).not.toThrow()
    }

    rewriter.rewriteSheet(other, 'document', hover)

    expect(warn.mock.calls).toEqual([
      [
        'visual-check: can\'t force states in the stylesheet https://cdn.example/a.css: it\'s cross-origin without CORS. Load it with crossorigin="anonymous" from a server that sends Access-Control-Allow-Origin.',
      ],
    ])
    expect(selectorTextsOf(other)).toEqual([twinnedButton])
    expect(rewriter.scopesOf(crossOrigin).size).toBe(0)
  })

  it('ignores another error reading the rules and retries on the next pass', () => {
    let reads = 0
    const sheet = fakeStyleSheet([fakeStyleRule('.btn:hover')])
    const rules = sheet.cssRules

    Object.defineProperty(sheet, 'cssRules', {
      get: () => {
        reads += 1

        if (reads === 1) {
          throw { name: 'InvalidAccessError' }
        }

        return rules
      },
    })

    const { rewriter, warn } = rewriterWithWarnings()

    rewriter.rewriteSheet(sheet, 'document', hover)
    rewriter.rewriteSheet(sheet, 'document', hover)

    expect(warn).not.toHaveBeenCalled()
    expect((rules[0] as CSSStyleRule).selectorText).toBe(twinnedButton)
  })

  it('warns once about a rejected selector and does not retry it', () => {
    const rule = fakeStyleRule('.btn:hover', { rejects: () => true })
    const { rewriter, warn } = rewriterWithWarnings()

    rewriter.rewriteSheet(fakeStyleSheet([rule]), 'document', hover)
    rewriter.rewriteSheet(fakeStyleSheet([rule]), 'document', hover)
    rewriter.rewriteSheet(fakeStyleSheet([fakeStyleRule('.btn:hover', { rejects: () => true })]), 'document', hover)

    expect(rule.selectorText).toBe('.btn:hover')
    expect(rule.selectorTextSets).toBe(1)
    expect(warn.mock.calls).toEqual([["visual-check: couldn't force states in the rule `.btn:hover`."]])
  })
})
