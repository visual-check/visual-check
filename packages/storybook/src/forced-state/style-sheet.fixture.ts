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
export interface FakeStyleSheetOptions {
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
 * A fake `CSSGroupingRule`, `@media` (`type` 4) unless another type is given, whose `insertRule` parses
 * `selector { body }`. Its prototype stands for `CSSGroupingRule.prototype`.
 */
export class FakeCSSGroupingRule {
  /**
   * The rule's `CSSRule` type.
   */
  readonly type: number
  /**
   * The rules in it.
   */
  readonly cssRules: CSSRule[]
  /**
   * The sheet it belongs to, if any.
   */
  parentStyleSheet: CSSStyleSheet | null = null

  /**
   * A rule of the type holding the rules.
   */
  constructor(type: number, rules: CSSRule[]) {
    this.type = type
    this.cssRules = rules
  }

  /**
   * Parses `selector { body }` and puts it in the rules at the index.
   */
  insertRule(text: string, index = 0): number {
    return insertParsedRule(this.cssRules, text, index, this.parentStyleSheet)
  }

  /**
   * Removes the rule at the index.
   */
  deleteRule(index: number): void {
    this.cssRules.splice(index, 1)
  }
}

/**
 * A fake `CSSStyleRule` (`type` 1) whose `selectorText` setter ignores what `rejects` returns true for. Like the real
 * one, it's a grouping rule, for nested rules.
 */
class FakeCSSStyleRule extends FakeCSSGroupingRule {
  /**
   * Its declarations.
   */
  style = { cssText: 'color: red;' }
  /**
   * Its selector list.
   */
  #selectorText: string
  /**
   * How many times `selectorText` was set.
   */
  #sets = 0
  /**
   * Whether the browser rejects a selector list.
   */
  readonly #rejects: ((selectorText: string) => boolean) | undefined

  /**
   * A style rule with the selector list.
   */
  constructor(selectorText: string, options: FakeStyleRuleOptions) {
    super(1, options.cssRules ?? [])
    this.#selectorText = selectorText
    this.#rejects = options.rejects
  }

  /**
   * The selector list.
   */
  get selectorText(): string {
    return this.#selectorText
  }

  /**
   * Sets the selector list, unless the browser rejects it.
   */
  set selectorText(value: string) {
    this.#sets += 1

    if (!this.#rejects?.(value)) {
      this.#selectorText = value
    }
  }

  /**
   * How many times `selectorText` was set, rejected values included.
   */
  get selectorTextSets(): number {
    return this.#sets
  }
}

/**
 * A fake `CSSStyleSheet` whose `insertRule`, `replaceSync` and `replace` parse `selector { body }`. Its prototype stands
 * for `CSSStyleSheet.prototype`.
 */
export class FakeCSSStyleSheet {
  /**
   * Its URL, for a `<link>` or `@import`ed sheet.
   */
  readonly href: string | null
  /**
   * The `<style>` or `<link>` it belongs to.
   */
  readonly ownerNode: unknown
  /**
   * Its rules.
   */
  #rules: CSSRule[]
  /**
   * Whether reading its rules throws a `SecurityError`.
   */
  readonly #crossOrigin: boolean

  /**
   * A sheet holding the rules.
   */
  constructor(rules: CSSRule[], options: FakeStyleSheetOptions = {}) {
    this.href = options.href ?? null
    this.ownerNode = options.ownerNode ?? null
    this.#rules = [...rules]
    this.#crossOrigin = options.crossOrigin ?? false
  }

  /**
   * Its rules; throws a `SecurityError` when it's cross-origin.
   */
  get cssRules(): CSSRule[] {
    if (this.#crossOrigin) {
      throw { name: 'SecurityError' }
    }

    return this.#rules
  }

  /**
   * Parses `selector { body }` and puts it in the rules at the index.
   */
  insertRule(text: string, index = 0): number {
    return insertParsedRule(this.#rules, text, index, this)
  }

  /**
   * Removes the rule at the index.
   */
  deleteRule(index: number): void {
    this.#rules.splice(index, 1)
  }

  /**
   * Replaces the rules with those parsed from `a { … } b { … }`.
   */
  replaceSync(text: string): void {
    this.#rules = this.#parsed(text)
  }

  /**
   * Replaces the rules a microtask later, as a parse would, without calling `replaceSync`, and resolves to the sheet.
   */
  async replace(text: string): Promise<this> {
    await undefined
    this.#rules = this.#parsed(text)

    return this
  }

  /**
   * The rules parsed from `a { … } b { … }`.
   */
  #parsed(text: string): CSSRule[] {
    return ruleTextsOf(text).map((ruleText) => parsedRuleOf(ruleText, this))
  }
}

/**
 * A fake `CSSStyleRule` (`type` 1) whose `selectorText` setter ignores what `rejects` returns true for.
 */
export function fakeStyleRule(selectorText: string, options: FakeStyleRuleOptions = {}): FakeStyleRule {
  return new FakeCSSStyleRule(selectorText, options) as unknown as FakeStyleRule
}

/**
 * A fake grouping rule, `@media` (`type` 4) unless another type is given.
 */
export function fakeGroupingRule(rules: CSSRule[], type = 4): CSSGroupingRule {
  return new FakeCSSGroupingRule(type, rules) as unknown as CSSGroupingRule
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
 * A fake `CSSStyleSheet` holding the rules.
 */
export function fakeStyleSheet(rules: CSSRule[], options: FakeStyleSheetOptions = {}): CSSStyleSheet {
  return new FakeCSSStyleSheet(rules, options) as unknown as CSSStyleSheet
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
