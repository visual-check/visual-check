/**
 * Names the items in order: `a`, `a and b`, or `a, b and c`.
 */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('')
  }

  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
