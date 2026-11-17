/**
 * Builds a counts line, such as `2 written · 1 kept`: each label with its count, in the order given, leaving out zero
 * counts except the first.
 *
 * @public
 */
export function countsLineOf(counts: readonly (readonly [label: string, count: number])[]): string {
  return counts.flatMap(([label, count], index) => (index === 0 || count > 0 ? [`${count} ${label}`] : [])).join(' · ')
}

/**
 * Labels a count of orphans: `orphan` for 1, `orphans` otherwise.
 *
 * @public
 */
export function orphanLabelOf(count: number): string {
  return count === 1 ? 'orphan' : 'orphans'
}
