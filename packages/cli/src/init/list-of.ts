/**
 * Names the items in order: `a`, `a and b`, or `a, b and c`.
 */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('')
  }

  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/**
 * Gives the items as a list known to hold at least one, such as a question's choices, or `undefined` when there are
 * none. The items are never `undefined` themselves.
 */
export function nonEmptyOf<T extends NonNullable<unknown>>(items: readonly T[]): readonly [T, ...T[]] | undefined {
  const [first, ...others] = items

  return first === undefined ? undefined : [first, ...others]
}
