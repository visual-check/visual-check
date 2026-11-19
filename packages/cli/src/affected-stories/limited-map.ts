/**
 * Maps every item with `map`, running at most `limit` at once, and gives the results in the items' order. Each slot
 * takes the next item in order until none are left. It rejects with the first error `map` gives; the slot that gave it
 * stops, but the other slots keep taking items until none are left.
 *
 * @throws {RangeError} When `limit` isn't a whole number of at least 1.
 */
export async function mapWithLimit<T, R>(
  limit: number,
  items: readonly T[],
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a whole number of at least 1, but it is ${limit}.`)
  }

  const results: R[] = new Array(items.length)
  let next = 0

  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next

      next += 1
      results[index] = await map(items[index] as T)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))

  return results
}
