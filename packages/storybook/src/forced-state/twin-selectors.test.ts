import { calculate } from '@bramus/specificity'
import { describe, expect, it } from 'vitest'
import { type ForcedState, forcedStates } from './forced-states.js'
import { type SheetScope, selectorListWithTwins } from './twin-selectors.js'

/**
 * Every forced state, listed.
 */
const all: ReadonlySet<ForcedState> = new Set(forcedStates)

/**
 * A single selector and the twins it gets, in order.
 */
type TwinRow = readonly [selector: string, twins: readonly string[]]

/**
 * Single selectors in a document sheet, with all five states listed.
 */
const documentRows: readonly TwinRow[] = [
  ['.btn:hover', ['.btn:is(.visual-check-hover *)']],
  ['.btn:active', ['.btn:is(.visual-check-active *)']],
  ['.btn:focus', ['.btn:is(.visual-check-focus *)']],
  ['.btn:focus-visible', ['.btn:is(.visual-check-focus-visible *)']],
  ['.field:focus-within', ['.field:is(.visual-check-focus-within *)']],
  ['.a:hover:focus', ['.a:is(.visual-check-hover *):is(.visual-check-focus *)']],
  ['.a:hover .b:hover', ['.a:is(.visual-check-hover *) .b:is(.visual-check-hover *)']],
  [':hover', [':is(.visual-check-hover *)']],
  ['ul > :hover', ['ul > :is(.visual-check-hover *)']],
  ['html.dark .btn:hover', ['html.dark .btn:is(.visual-check-hover *)']],
  ['.btn:hover::before', ['.btn:is(.visual-check-hover *)::before']],
  ['.list::-webkit-scrollbar-thumb:hover', ['.list:is(.visual-check-hover *)::-webkit-scrollbar-thumb']],
  ['x-chip::part(label):hover', ['x-chip:is(.visual-check-hover *)::part(label)']],
  ['.a::before:hover:focus', ['.a:is(.visual-check-hover *):is(.visual-check-focus *)::before']],
  ['.a:hover:not(:focus)', ['.a:is(.visual-check-hover *):not(:focus)']],
  [':where(.a:hover)', [':where(.a:is(.visual-check-hover *))']],
  [':is(.a:hover, #b)', [':is(.a:is(.visual-check-hover *), #b)']],
  ['.card:has(button:hover)', ['.card:has(button:is(.visual-check-hover *))']],
  ['li:nth-child(2 of .item:hover)', ['li:nth-child(2 of .item:is(.visual-check-hover *))']],
  ['&:is(:where(.group):hover *)', ['&:is(:where(.group):is(.visual-check-hover *) *)']],
  ['.hover\\:underline:hover', ['.hover\\:underline:is(.visual-check-hover *)']],
  ['.a\\::hover', ['.a\\::is(.visual-check-hover *)']],
  ['[title=":hover"]:focus', ['[title=":hover"]:is(.visual-check-focus *)']],
  [':is(.a, .b):hover', [':is(.a, .b):is(.visual-check-hover *)']],
]

/**
 * Single selectors in a shadow-root sheet, with all five states listed.
 */
const shadowRootRows: readonly TwinRow[] = [
  ['button:hover', ['button:is(.visual-check-hover *)', ':host(:where(.visual-check-hover)) button']],
  [':host(:hover)', [':host(.visual-check-hover)']],
  [':host(:hover) .label', [':host(.visual-check-hover) .label']],
  [':host(.primary) button:hover', [':host(.primary:where(.visual-check-hover)) button:is(*, .visual-check-hover)']],
  [
    ':host(:hover) button:focus',
    [':host(.visual-check-hover:where(.visual-check-focus)) button:is(*, .visual-check-focus)'],
  ],
  [
    ':host button:focus-visible',
    [':host(:where(.visual-check-focus-visible)) button:is(*, .visual-check-focus-visible)'],
  ],
  [':hover > span', [':is(.visual-check-hover *) > span', ':host(:where(.visual-check-hover)) * > span']],
  [
    '.a:hover .b:focus',
    [
      '.a:is(.visual-check-hover *) .b:is(.visual-check-focus *)',
      ':host(:where(.visual-check-hover.visual-check-focus)) .a .b:is(*, .visual-check-focus)',
    ],
  ],
  ['::slotted(button:hover)', [':host(:where(.visual-check-hover)) ::slotted(button)']],
  [':is(.a:hover)', [':is(.a:is(.visual-check-hover *))']],
  [
    'x-icon::part(glyph):hover',
    ['x-icon:is(.visual-check-hover *)::part(glyph)', ':host(:where(.visual-check-hover)) x-icon::part(glyph)'],
  ],
  ['&:hover', ['&:is(.visual-check-hover *)', ':host(:where(.visual-check-hover)) &']],
]

/**
 * A selector's specificity as (ids, classes, types), from `@bramus/specificity`. It counts `&` as nothing, so `&` is
 * read as `:is(.parent)`, the selector it stands for in nested CSS.
 */
function specificityOf(selector: string): number[] | undefined {
  return calculate(selector.replaceAll('&', ':is(.parent)'))[0]?.toArray()
}

/**
 * Each row's selector beside each of its twins, in a scope.
 */
function twinPairsOf(rows: readonly TwinRow[], scope: SheetScope): (readonly [string, string, SheetScope])[] {
  return rows.flatMap(([selector, twins]) => twins.map((twin) => [selector, twin, scope] as const))
}

describe('selectorListWithTwins in a document sheet', () => {
  it.each(documentRows)('twins %s', (selector, twins) => {
    expect(selectorListWithTwins(selector, all, 'document')).toBe([selector, ...twins].join(', '))
  })

  it.each([
    ['.a:hover, .b, .c:focus', '.a:hover, .b, .c:focus, .a:is(.visual-check-hover *), .c:is(.visual-check-focus *)'],
    [
      '.btn:hover, .btn.pseudo-hover, .pseudo-hover-all .btn',
      '.btn:hover, .btn.pseudo-hover, .pseudo-hover-all .btn, .btn:is(.visual-check-hover *)',
    ],
    [
      '.a:hover:focus, .a:is(.visual-check-hover *):focus',
      '.a:hover:focus, .a:is(.visual-check-hover *):focus, .a:is(.visual-check-hover *):is(.visual-check-focus *)',
    ],
  ])('appends the twins of the list %s after it', (selectorText, expected) => {
    expect(selectorListWithTwins(selectorText, all, 'document')).toBe(expected)
  })

  it.each([
    ':active-view-transition',
    '.a:not(:hover)',
    ':not(.a:hover) .b',
    '.a:is(:not(:hover))',
    ':not(:is(:hover))',
    '.md\\:hover\\:x',
    '[title=":hover"]',
    "[title=':hover']",
    '.a:hover, .a:is(.visual-check-hover *)',
    ':host(:hover)',
    '.plain',
  ])('adds nothing to %s', (selectorText) => {
    expect(selectorListWithTwins(selectorText, all, 'document')).toBeNull()
  })

  it.each([
    ['.btn:focus-visible', null],
    ['.btn:focus-within', null],
    ['.btn:focus', '.btn:focus, .btn:is(.visual-check-focus *)'],
  ])('with only focus listed, tells :focus from longer states in %s', (selectorText, expected) => {
    expect(selectorListWithTwins(selectorText, new Set(['focus']), 'document')).toBe(expected)
  })

  it('keeps states that are not listed real', () => {
    expect(selectorListWithTwins('.a:hover:focus', new Set(['hover']), 'document')).toBe(
      '.a:hover:focus, .a:is(.visual-check-hover *):focus',
    )
  })
})

describe('selectorListWithTwins in a shadow-root sheet', () => {
  it.each(shadowRootRows)('twins %s', (selector, twins) => {
    expect(selectorListWithTwins(selector, all, 'shadow-root')).toBe([selector, ...twins].join(', '))
  })

  it.each([':host-context(.dark) button:hover', 'button:not(:hover)'])('adds nothing to %s', (selectorText) => {
    expect(selectorListWithTwins(selectorText, all, 'shadow-root')).toBeNull()
  })
})

describe('twin specificity', () => {
  it('gives .btn:hover and its twin the same specificity, (0,2,0)', () => {
    expect(specificityOf('.btn:hover')).toEqual([0, 2, 0])
    expect(specificityOf('.btn:is(.visual-check-hover *)')).toEqual([0, 2, 0])
  })

  it.each([...twinPairsOf(documentRows, 'document'), ...twinPairsOf(shadowRootRows, 'shadow-root')])(
    '%s and its twin %s have the same specificity (%s sheet)',
    (selector, twin) => {
      expect(specificityOf(twin)).toEqual(specificityOf(selector))
    },
  )
})
