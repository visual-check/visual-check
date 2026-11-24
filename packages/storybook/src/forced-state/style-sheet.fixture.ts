/**
 * A fake style rule, with a count of the times its `selectorText` was set.
 */
export type FakeStyleRule = CSSStyleRule & {
  /**
   * How many times `selectorText` was set, rejected values included.
   */
  readonly selectorTextSets: number
}

/**
 * What a fake style rule is given besides its selector.
 */
interface FakeStyleRuleOptions {
  /**
   * The rules nested in it.
   */
  cssRules?: CSSRule[]
  /**
   * Whether the browser rejects a selector list set on it, leaving `selectorText` as it was.
   */
  rejects?: (selectorText: string) => boolean
}

/**
 * What a fake stylesheet is given besides its rules.
 */
interface FakeStyleSheetOptions {
  /**
   * Its URL, for a `<link>` or `@import`ed sheet.
   */
  href?: string
  /**
   * Whether it's cross-origin without CORS, so reading its `cssRules` throws a `SecurityError`.
   */
  crossOrigin?: boolean
  /**
   * The `<style>` or `<link>` it belongs to.
   */
  ownerNode?: unknown
}

/**
 * Matches one rule's text, `selector { body }`, capturing both.
 */
const ruleTextPattern = /^\s*([^{]+?)\s*\{\s*(.*?)\s*\}\s*$/s

/**
 * A fake `CSSStyleRule` (`type` 1) whose `selectorText` setter ignores what `rejects` returns true for.
 */
export function fakeStyleRule(selectorText: string, options: FakeStyleRuleOptions = {}): FakeStyleRule {
  let current = selectorText
  let sets = 0
  const cssRules = options.cssRules ?? []
  const rule = {
    type: 1,
    style: { cssText: 'color: red;' },
    cssRules,
    parentStyleSheet: null,
    get selectorText() {
      return current
    },
    set selectorText(value: string) {
      sets += 1

      if (!options.rejects?.(value)) {
        current = value
      }
    },
    get selectorTextSets() {
      return sets
    },
    insertRule: (text: string, index = 0) => insertParsedRule(cssRules, text, index, null),
    deleteRule: (index: number) => {
      cssRules.splice(index, 1)
    },
  }

  return rule as unknown as FakeStyleRule
}

/**
 * A fake grouping rule, `@media` (`type` 4) unless another type is given.
 */
export function fakeGroupingRule(rules: CSSRule[], type = 4): CSSGroupingRule {
  return { type, cssRules: rules } as unknown as CSSGroupingRule
}

/**
 * A fake `@import` rule (`type` 3) of a sheet, or of nothing yet.
 */
export function fakeImportRule(sheet: CSSStyleSheet | null): CSSImportRule {
  return { type: 3, styleSheet: sheet } as unknown as CSSImportRule
}

/**
 * A fake `@keyframes` rule (`type` 7), with a keyframe whose `keyText` reads like a selector.
 */
export function fakeKeyframesRule(): CSSKeyframesRule {
  return { type: 7, cssRules: [{ type: 8, keyText: ':hover' }] } as unknown as CSSKeyframesRule
}

/**
 * A fake `CSSStyleSheet` holding the rules, whose `insertRule`, `replaceSync` and `replace` parse `selector { body }`.
 */
export function fakeStyleSheet(rules: CSSRule[], options: FakeStyleSheetOptions = {}): CSSStyleSheet {
  let cssRules = [...rules]
  const sheet = {
    href: options.href ?? null,
    ownerNode: options.ownerNode ?? null,
    get cssRules() {
      if (options.crossOrigin) {
        throw { name: 'SecurityError' }
      }

      return cssRules
    },
    insertRule: (text: string, index = 0) => insertParsedRule(cssRules, text, index, sheet),
    deleteRule: (index: number) => {
      cssRules.splice(index, 1)
    },
    replaceSync: (text: string) => {
      cssRules = ruleTextsOf(text).map((ruleText) => parsedRuleOf(ruleText, sheet))
    },
    replace: async (text: string) => {
      sheet.replaceSync(text)

      return sheet
    },
  }

  return sheet as unknown as CSSStyleSheet
}

/**
 * The `selectorText` of each style rule in the sheet, nested and grouped ones included, in order.
 */
export function selectorTextsOf(sheet: CSSStyleSheet): string[] {
  return selectorTextsIn(Array.from(sheet.cssRules))
}

/**
 * The `selectorText` of each style rule in the rules and the rules in them, in order.
 */
function selectorTextsIn(rules: CSSRule[]): string[] {
  return rules.flatMap((rule) => {
    const own = rule.type === 1 ? [(rule as CSSStyleRule).selectorText] : []
    const nested = 'cssRules' in rule ? selectorTextsIn(Array.from((rule as CSSGroupingRule).cssRules)) : []

    return [...own, ...nested]
  })
}

/**
 * Parses `selector { body }` into a fake style rule and puts it in the list at the index, as `insertRule` does.
 */
function insertParsedRule(rules: CSSRule[], text: string, index: number, sheet: unknown): number {
  rules.splice(index, 0, parsedRuleOf(text, sheet))

  return index
}

/**
 * A fake style rule parsed from `selector { body }`, belonging to the sheet.
 */
function parsedRuleOf(text: string, sheet: unknown): CSSRule {
  const match = ruleTextPattern.exec(text)

  if (match === null) {
    throw new SyntaxError(`fake stylesheet: can't parse the rule \`${text}\``)
  }

  const rule = fakeStyleRule(match[1] ?? '')

  Object.assign(rule, { parentStyleSheet: sheet, style: { cssText: match[2] ?? '' } })

  return rule
}

/**
 * Each rule's text in a stylesheet's text, `a { … } b { … }`.
 */
function ruleTextsOf(text: string): string[] {
  return text
    .split('}')
    .filter((part) => part.trim() !== '')
    .map((part) => `${part}}`)
}
