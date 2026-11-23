/**
 * Gives the `clip-path` that cuts the snapshot off left of the position, where the baseline shows. The position is in
 * percent of the area's width, and one outside 0 to 100 counts as the nearer end.
 */
export function clipPathOf(position: number): string {
  return `inset(0 0 0 ${Math.min(Math.max(position, 0), 100)}%)`
}

/**
 * Says how much of each image shows at a position from 0 to 100.
 */
export function valueTextOf(position: number): string {
  return `Baseline ${position}%, snapshot ${100 - position}%`
}
