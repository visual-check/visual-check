import { type ForcedState, forcedStateClassOf, forcedStates } from './forced-states.js'

/**
 * Where a stylesheet applies: the document's own sheets, or a shadow root's (and constructed sheets not known to be the
 * document's).
 */
export type SheetScope = 'document' | 'shadow-root'

/**
 * Matches a selector that is one of our own twins, which is never twinned again.
 */
const ownTwinPattern = new RegExp(`\\.visual-check-(?:${forcedStates.join('|')})(?![\\w-])`)

/**
 * Matches a character of a pseudo-class or pseudo-element name.
 */
const nameCharacterPattern = /[\w-]/

/**
 * Matches a character that would make a state name part of a longer name or a function.
 */
const nameContinuationPattern = /[\w(-]/

/**
 * Matches a character that ends a compound selector at the top level.
 */
const compoundEndPattern = /[\s>+~),]/

/**
 * Matches the character before a compound selector: one that ends the previous compound, or `(`.
 */
const compoundStartPattern = /[\s>+~(,]/

/**
 * Matches a pseudo-class or pseudo-element only a shadow-root sheet can match. Sticky: it matches at `lastIndex`.
 */
const shadowOnlyPattern = /::?(?:host|host-context|slotted)(?![\w-])/y

/**
 * The closing character of each character that opens a string or an attribute selector.
 */
const closerOf: Readonly<Record<string, string>> = { '"': '"', "'": "'", '[': ']' }

/**
 * A parenthesis open around a character: the functional pseudo-class or pseudo-element it belongs to, with its colons,
 * or empty, and its index.
 */
interface Parenthesis {
  /**
   * The name, such as `:not`, `:host` or `::slotted`, or empty.
   */
  name: string
  /**
   * The index of the opening parenthesis.
   */
  index: number
}

/**
 * A listed state written in a selector, outside `:not()`.
 */
interface Occurrence {
  /**
   * The state.
   */
  state: ForcedState
  /**
   * The index of its colon.
   */
  start: number
  /**
   * The index just after its name.
   */
  end: number
  /**
   * Whether it's inside `:host()` or `:host-context()`.
   */
  host: boolean
  /**
   * Whether it's in the selector's top level, or directly inside `::slotted()`.
   */
  topLevel: boolean
  /**
   * Whether it's the first thing in its compound selector, when it's in the top level.
   */
  startsCompound: boolean
  /**
   * The index of the pseudo-element it follows in its compound, which it moves in front of, or null.
   */
  pseudoElementIndex: number | null
}

/**
 * What one pass over a selector finds.
 */
interface ScannedSelector {
  /**
   * The listed states it uses outside `:not()`, in order.
   */
  occurrences: Occurrence[]
  /**
   * Whether it uses `:host`, `:host-context()` or `::slotted()`, which only a shadow-root sheet can match.
   */
  shadowOnly: boolean
  /**
   * The index of each closing parenthesis, by the index of its opening one.
   */
  closingParenthesisOf: Map<number, number>
}

/**
 * What a scan has found so far.
 */
interface ScanProgress {
  /**
   * The occurrences so far.
   */
  occurrences: Occurrence[]
  /**
   * Whether a shadow-only part was seen.
   */
  shadowOnly: boolean
  /**
   * The index of the first pseudo-element in the current top-level compound, or null.
   */
  pseudoElementIndex: number | null
  /**
   * The index of the last pseudo-element's second colon, which starts nothing, or null. Checking for a colon right
   * before a colon instead would misfire after an escaped one: in `.a\::hover`, the colon of `:hover` follows the
   * escaped colon of the class name `a:`.
   */
  pseudoElementSecondColonIndex: number | null
}

/**
 * One change to a selector's text.
 */
interface Edit {
  /**
   * Where the change starts.
   */
  index: number
  /**
   * How many characters it removes there.
   */
  removeLength: number
  /**
   * What it inserts there.
   */
  insert: string
}

/**
 * The selector list with the twins it lacks appended after its own selectors, in their order (for each: light twin,
 * then host twin), or null when there's nothing to add. Twins of states not in `states` aren't made.
 *
 * A light twin replaces each state with `:is(.visual-check-<state> *)`, which matches under an ancestor with the class
 * at the same specificity. A host twin, made only in a shadow-root sheet, puts the condition on the shadow host.
 *
 * `selectorText` is expected as the CSSOM serializes it, with pseudo-class and pseudo-element names in lowercase:
 * names are matched as written, so `:HOVER` is not twinned.
 *
 * Adapted from Storybook's pseudo-states addon (`storybook-addon-pseudo-states`, MIT): the selector splitting from its
 * `splitSelectors` and the escape handling from its `findPseudoStates`. See THIRD-PARTY-NOTICES.md at the package root.
 */
export function selectorListWithTwins(
  selectorText: string,
  states: ReadonlySet<ForcedState>,
  scope: SheetScope,
): string | null {
  const selectors = selectorsOf(selectorText).map((selector) => selector.trim())
  const twins = [...new Set(selectors.flatMap((selector) => twinsOf(selector, states, scope)))].filter(
    (twin) => !selectors.includes(twin),
  )

  if (twins.length === 0) {
    return null
  }

  return [selectorText, ...twins].join(', ')
}

/**
 * One selector's twins: its light twin, then its host twin, each when it can be made.
 */
function twinsOf(selector: string, states: ReadonlySet<ForcedState>, scope: SheetScope): string[] {
  if (ownTwinPattern.test(selector)) {
    return []
  }

  const scanned = scan(selector, states)

  if (scanned.occurrences.length === 0) {
    return []
  }

  const lightTwin = scanned.shadowOnly ? null : lightTwinOf(selector, scanned.occurrences)
  const hostTwin = scope === 'shadow-root' ? hostTwinOf(selector, scanned) : null

  return [lightTwin, hostTwin].filter((twin) => twin !== null)
}

/**
 * The selectors of a list, split at top-level commas: commas inside `()`, `[]` and strings don't split.
 */
function selectorsOf(selectorText: string): string[] {
  const selectors: string[] = []
  let selectorStart = 0

  walk(selectorText, (index, parentheses) => {
    if (selectorText[index] === ',' && parentheses.length === 0) {
      selectors.push(selectorText.slice(selectorStart, index))
      selectorStart = index + 1
    }
  })
  selectors.push(selectorText.slice(selectorStart))

  return selectors
}

/**
 * Calls `visit` for each character of a selector that isn't escaped, in a string or in an attribute selector, or a
 * closing parenthesis, with the parentheses open around it. Returns the index of each closing parenthesis, by the index
 * of its opening one.
 */
function walk(
  selector: string,
  visit: (index: number, parentheses: readonly Parenthesis[]) => void,
): Map<number, number> {
  const isHidden = hiddenTextTracker()
  const parentheses: Parenthesis[] = []
  const closingParenthesisOf = new Map<number, number>()

  for (let index = 0; index < selector.length; index++) {
    const character = selector[index] as string

    if (character === '\\') {
      index++
      continue
    }

    if (isHidden(character)) {
      continue
    }

    if (character === ')') {
      closeParenthesis(parentheses, index, closingParenthesisOf)
      continue
    }

    visit(index, parentheses)

    if (character === '(') {
      parentheses.push({ name: functionNameBefore(selector, index), index })
    }
  }

  return closingParenthesisOf
}

/**
 * The functional pseudo-class or pseudo-element name, with its colons, that ends right before `index`, or empty.
 */
function functionNameBefore(selector: string, index: number): string {
  let nameStart = index

  while (nameStart > 0 && nameCharacterPattern.test(selector[nameStart - 1] as string)) {
    nameStart--
  }

  let start = nameStart

  while (start > 0 && nameStart - start < 2 && selector[start - 1] === ':') {
    start--
  }

  return start === nameStart ? '' : selector.slice(start, index)
}

/**
 * Closes the innermost open parenthesis at `index`, recording where it closes. A stray one closes nothing.
 */
function closeParenthesis(parentheses: Parenthesis[], index: number, closingParenthesisOf: Map<number, number>): void {
  const opening = parentheses.pop()

  if (opening !== undefined) {
    closingParenthesisOf.set(opening.index, index)
  }
}

/**
 * A function that takes a selector's characters in order and tells whether each is inside, or delimits, a string or an
 * attribute selector.
 */
function hiddenTextTracker(): (character: string) => boolean {
  const closers: string[] = []

  return (character) => {
    const open = closers.at(-1)

    if (character === open) {
      closers.pop()

      return true
    }

    const closer = closerOf[character]

    if (closer !== undefined && open !== '"' && open !== "'") {
      closers.push(closer)

      return true
    }

    return open !== undefined
  }
}

/**
 * One pass over a selector: the listed states it uses outside `:not()` and where its shadow-only parts are.
 */
function scan(selector: string, states: ReadonlySet<ForcedState>): ScannedSelector {
  const progress: ScanProgress = {
    occurrences: [],
    shadowOnly: false,
    pseudoElementIndex: null,
    pseudoElementSecondColonIndex: null,
  }
  const closingParenthesisOf = walk(selector, (index, parentheses) => {
    const character = selector[index] as string

    if (parentheses.length === 0 && compoundEndPattern.test(character)) {
      progress.pseudoElementIndex = null
    } else if (character === ':' && index !== progress.pseudoElementSecondColonIndex) {
      scanColon(selector, index, parentheses, states, progress)
    }
  })

  return { occurrences: progress.occurrences, shadowOnly: progress.shadowOnly, closingParenthesisOf }
}

/**
 * Records what starts at the colon at `index`: a pseudo-element, which a later top-level state moves in front of, or
 * an occurrence of a listed state.
 */
function scanColon(
  selector: string,
  index: number,
  parentheses: readonly Parenthesis[],
  states: ReadonlySet<ForcedState>,
  progress: ScanProgress,
): void {
  const topLevel = parentheses.length === 0

  shadowOnlyPattern.lastIndex = index
  progress.shadowOnly ||= shadowOnlyPattern.test(selector)

  if (selector[index + 1] === ':') {
    progress.pseudoElementIndex ??= topLevel ? index : null
    progress.pseudoElementSecondColonIndex = index + 1

    return
  }

  const occurrence = occurrenceAt(selector, index, parentheses, states)

  if (occurrence !== null) {
    progress.occurrences.push({ ...occurrence, pseudoElementIndex: topLevel ? progress.pseudoElementIndex : null })
  }
}

/**
 * The occurrence of a listed state whose colon is at `index`, without the pseudo-element it follows, or null when the
 * state isn't listed or is inside `:not()`.
 */
function occurrenceAt(
  selector: string,
  index: number,
  parentheses: readonly Parenthesis[],
  states: ReadonlySet<ForcedState>,
): Omit<Occurrence, 'pseudoElementIndex'> | null {
  const state = stateAt(selector, index + 1, states)
  const names = parentheses.map((parenthesis) => parenthesis.name)

  if (state === null || names.includes(':not')) {
    return null
  }

  return {
    state,
    start: index,
    end: index + 1 + state.length,
    host: names.includes(':host') || names.includes(':host-context'),
    topLevel: names.length === 0 || (names.length === 1 && names[0] === '::slotted'),
    startsCompound: compoundStartPattern.test(selector[index - 1] ?? ' '),
  }
}

/**
 * The listed state whose name starts at `index` and isn't the start of a longer name, or null.
 */
function stateAt(selector: string, index: number, states: ReadonlySet<ForcedState>): ForcedState | null {
  for (const state of states) {
    const following = selector[index + state.length] ?? ''

    if (selector.startsWith(state, index) && !nameContinuationPattern.test(following)) {
      return state
    }
  }

  return null
}

/**
 * The twin that matches under an ancestor with each state's class: every occurrence becomes
 * `:is(.visual-check-<state> *)`, moved in front of the pseudo-element it follows.
 */
function lightTwinOf(selector: string, occurrences: readonly Occurrence[]): string {
  return withEdits(
    selector,
    occurrences.flatMap((occurrence) => replacing(occurrence, `:is(.${forcedStateClassOf(occurrence.state)} *)`)),
  )
}

/**
 * The twin that matches in a shadow tree when its host has each state's class, at the same specificity, or null when
 * the selector can't keep its specificity that way.
 */
function hostTwinOf(selector: string, scanned: ScannedSelector): string | null {
  const hostEdits = scanned.occurrences
    .filter((occurrence) => occurrence.host)
    .flatMap((occurrence) => replacing(occurrence, `.${forcedStateClassOf(occurrence.state)}`))
  const shadowTreeOccurrences = scanned.occurrences.filter((occurrence) => !occurrence.host)

  if (shadowTreeOccurrences.length === 0) {
    return withEdits(selector, hostEdits)
  }

  if (selector.startsWith(':host-context(')) {
    return null
  }

  const classes = forcedStates
    .filter((state) => shadowTreeOccurrences.some((occurrence) => occurrence.state === state))
    .map((state) => `.${forcedStateClassOf(state)}`)
    .join('')
  const condition = `:where(${classes})`
  const standIns = (occurrences: readonly Occurrence[]) =>
    occurrences.flatMap((occurrence) => replacing(occurrence, `:is(*, .${forcedStateClassOf(occurrence.state)})`))

  if (selector.startsWith(':host(')) {
    const closing = scanned.closingParenthesisOf.get(':host'.length) ?? selector.length

    return withEdits(selector, [
      ...hostEdits,
      { index: closing, removeLength: 0, insert: condition },
      ...standIns(shadowTreeOccurrences),
    ])
  }

  if (selector.startsWith(':host')) {
    return withEdits(selector, [
      { index: 0, removeLength: ':host'.length, insert: `:host(${condition})` },
      ...hostEdits,
      ...standIns(shadowTreeOccurrences),
    ])
  }

  const removed = shadowTreeOccurrences.find((occurrence) => occurrence.topLevel)

  if (removed === undefined) {
    return null
  }

  const others = shadowTreeOccurrences.filter((occurrence) => occurrence !== removed)
  const twin = withEdits(selector, [
    {
      index: removed.start,
      removeLength: removed.end - removed.start,
      insert: leavesCompoundEmpty(selector, removed) ? '*' : '',
    },
    ...hostEdits,
    ...standIns(others),
  ])

  return `:host(${condition}) ${twin}`
}

/**
 * Whether removing the occurrence leaves its compound selector with nothing in it.
 */
function leavesCompoundEmpty(selector: string, occurrence: Occurrence): boolean {
  const following = selector[occurrence.end]

  return (
    occurrence.startsCompound &&
    (following === undefined || compoundEndPattern.test(following) || selector.startsWith('::', occurrence.end))
  )
}

/**
 * The edits that replace an occurrence with `replacement`, inserted in front of the pseudo-element it follows if any.
 */
function replacing(occurrence: Occurrence, replacement: string): Edit[] {
  const removeLength = occurrence.end - occurrence.start

  if (occurrence.pseudoElementIndex === null) {
    return [{ index: occurrence.start, removeLength, insert: replacement }]
  }

  return [
    { index: occurrence.start, removeLength, insert: '' },
    { index: occurrence.pseudoElementIndex, removeLength: 0, insert: replacement },
  ]
}

/**
 * The selector with the edits applied. Edits at the same index keep their order.
 */
function withEdits(selector: string, edits: readonly Edit[]): string {
  const ordered = edits
    .map((edit, order) => ({ edit, order }))
    .sort((left, right) => right.edit.index - left.edit.index || right.order - left.order)
  let result = selector

  for (const { edit } of ordered) {
    result = result.slice(0, edit.index) + edit.insert + result.slice(edit.index + edit.removeLength)
  }

  return result
}
