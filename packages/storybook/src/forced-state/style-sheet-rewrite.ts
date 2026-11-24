import type { ForcedState } from './forced-states.js'
import { type SheetScope, selectorListWithTwins } from './twin-selectors.js'

/**
 * What rewrites stylesheets for forced states, and remembers which rules and sheets it did, for which scope and states.
 */
export interface StyleSheetRewriter {
  /**
   * Rewrites every style rule of the sheet, in grouping rules, nested rules and imported sheets too, unless already
   * done for these states in this scope.
   */
  rewriteSheet(sheet: CSSStyleSheet, scope: SheetScope, states: ReadonlySet<ForcedState>): void
  /**
   * Rewrites one rule and the rules in it, as after `insertRule`.
   */
  rewriteRule(rule: CSSRule, scope: SheetScope, states: ReadonlySet<ForcedState>): void
  /**
   * Forgets the sheet was done, so the next `rewriteSheet` walks it again, as after `replaceSync` or a `<link>`'s load.
   */
  forgetSheet(sheet: CSSStyleSheet): void
  /**
   * The scopes the sheet has been rewritten in so far: how an `insertRule` into a constructed sheet finds its scope.
   */
  scopesOf(sheet: CSSStyleSheet): ReadonlySet<SheetScope>
}

/**
 * A rewriter's memory and how it reports.
 */
interface RewriteContext {
  /**
   * The `${scope}:${state}` tokens each style rule was done for.
   */
  doneRules: WeakMap<CSSRule, Set<string>>
  /**
   * The `${scope}:${state}` tokens each sheet was walked for.
   */
  doneSheets: WeakMap<CSSStyleSheet, Set<string>>
  /**
   * The scopes each sheet was walked in.
   */
  sheetScopes: WeakMap<CSSStyleSheet, Set<SheetScope>>
  /**
   * The warnings already given, so each is given once.
   */
  warned: Set<string>
  /**
   * Reports a warning.
   */
  warn: (message: string) => void
}

/**
 * One pass's scope and states, and their bookkeeping tokens.
 */
interface RewritePass {
  /**
   * Where the sheets apply.
   */
  scope: SheetScope
  /**
   * The states to force.
   */
  states: ReadonlySet<ForcedState>
  /**
   * The `${scope}:${state}` token of each state.
   */
  tokens: string[]
}

/**
 * `CSSRule.STYLE_RULE`, written out: Node has no `CSSRule`.
 */
const styleRuleType = 1

/**
 * `CSSRule.IMPORT_RULE`.
 */
const importRuleType = 3

/**
 * A rewriter that reports through `warn`.
 */
export function styleSheetRewriterOf(warn: (message: string) => void): StyleSheetRewriter {
  const context: RewriteContext = {
    doneRules: new WeakMap(),
    doneSheets: new WeakMap(),
    sheetScopes: new WeakMap(),
    warned: new Set(),
    warn,
  }

  return {
    rewriteSheet: (sheet, scope, states) => rewriteSheet(context, passOf(scope, states), sheet),
    rewriteRule: (rule, scope, states) => rewriteRule(context, passOf(scope, states), rule),
    forgetSheet: (sheet) => {
      context.doneSheets.delete(sheet)
    },
    scopesOf: (sheet) => context.sheetScopes.get(sheet) ?? new Set(),
  }
}

/**
 * A pass over the states in a scope, with their bookkeeping tokens: `${scope}:${state}`.
 */
function passOf(scope: SheetScope, states: ReadonlySet<ForcedState>): RewritePass {
  return { scope, states, tokens: [...states].map((state) => `${scope}:${state}`) }
}

/**
 * Whether the rule or sheet was done for every token.
 */
function isDone<Key extends WeakKey>(done: WeakMap<Key, Set<string>>, key: Key, tokens: string[]): boolean {
  const doneTokens = done.get(key)

  return doneTokens !== undefined && tokens.every((token) => doneTokens.has(token))
}

/**
 * Records the rule or sheet as done for the tokens.
 */
function markDone<Key extends WeakKey>(done: WeakMap<Key, Set<string>>, key: Key, tokens: string[]): void {
  done.set(key, new Set([...(done.get(key) ?? []), ...tokens]))
}

/**
 * Walks the sheet's rules unless it was walked for this pass. A sheet whose rules can't be read is left undone, unless
 * it's cross-origin, which can't change: that one is marked done but not rewritten in the scope.
 */
function rewriteSheet(context: RewriteContext, pass: RewritePass, sheet: CSSStyleSheet): void {
  if (isDone(context.doneSheets, sheet, pass.tokens)) {
    return
  }

  const rules = readableRulesOf(context, sheet)

  if (rules === 'retry') {
    return
  }

  markDone(context.doneSheets, sheet, pass.tokens)

  if (rules === 'cross-origin') {
    return
  }

  for (const rule of rules) {
    rewriteRule(context, pass, rule)
  }

  context.sheetScopes.set(sheet, (context.sheetScopes.get(sheet) ?? new Set<SheetScope>()).add(pass.scope))
}

/**
 * The sheet's rules; `'cross-origin'` for a cross-origin sheet, which warns once per `href`; `'retry'` on any other
 * error.
 */
function readableRulesOf(context: RewriteContext, sheet: CSSStyleSheet): CSSRule[] | 'cross-origin' | 'retry' {
  try {
    return Array.from(sheet.cssRules)
  } catch (error) {
    if (!isSecurityError(error)) {
      return 'retry'
    }

    warnOnce(
      context,
      `visual-check: can't force states in the stylesheet ${sheet.href}: it's cross-origin without CORS. Load it with crossorigin="anonymous" from a server that sends Access-Control-Allow-Origin.`,
    )

    return 'cross-origin'
  }
}

/**
 * Whether a thrown value is the `SecurityError` a cross-origin sheet's `cssRules` throws.
 */
function isSecurityError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'SecurityError'
}

/**
 * Rewrites a rule by its type: a style rule's selector and the rules nested in it, a grouping rule's rules, or an
 * imported sheet. Anything else, `@keyframes`, `@font-face` and `@page` included, is left alone.
 */
function rewriteRule(context: RewriteContext, pass: RewritePass, rule: CSSRule): void {
  if (rule.type === importRuleType) {
    rewriteImport(context, pass, rule as CSSImportRule)

    return
  }

  if (rule.type === styleRuleType) {
    rewriteSelector(context, pass, rule as CSSStyleRule)
  }

  // `@keyframes` has `cssRules` too, but its keyframes are never style rules.
  if ('cssRules' in rule) {
    for (const child of Array.from((rule as CSSGroupingRule).cssRules)) {
      rewriteRule(context, pass, child)
    }
  }
}

/**
 * Walks an `@import`ed sheet, once it's loaded.
 */
function rewriteImport(context: RewriteContext, pass: RewritePass, rule: CSSImportRule): void {
  if (rule.styleSheet !== null) {
    rewriteSheet(context, pass, rule.styleSheet)
  }
}

/**
 * Gives a style rule's selector list its twins, in place, unless it was done for these states in this scope. A list
 * the browser rejects warns once per original selector text and isn't retried.
 */
function rewriteSelector(context: RewriteContext, pass: RewritePass, rule: CSSStyleRule): void {
  if (isDone(context.doneRules, rule, pass.tokens)) {
    return
  }

  markDone(context.doneRules, rule, pass.tokens)

  const original = rule.selectorText
  const rewritten = selectorListWithTwins(original, pass.states, pass.scope)

  if (rewritten === null) {
    return
  }

  rule.selectorText = rewritten

  if (rule.selectorText === original) {
    warnOnce(context, `visual-check: couldn't force states in the rule \`${original}\`.`)
  }
}

/**
 * Reports a warning unless it was already given.
 */
function warnOnce(context: RewriteContext, message: string): void {
  if (context.warned.has(message)) {
    return
  }

  context.warned.add(message)
  context.warn(message)
}
