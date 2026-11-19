import { describe, expect, it } from 'vitest'
import { mapWithLimit } from './limited-map.js'

/**
 * Waits for the given time, in milliseconds.
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

describe('mapWithLimit', () => {
  it('runs at most the limit at once', async () => {
    let running = 0
    let mostRunning = 0

    await mapWithLimit(2, [1, 2, 3, 4, 5], async () => {
      running += 1
      mostRunning = Math.max(mostRunning, running)
      await wait(10)
      running -= 1
    })

    expect(mostRunning).toBe(2)
  })

  it("gives the results in the items' order, whichever finishes first", async () => {
    const results = await mapWithLimit(3, [30, 10, 20, 0], async (milliseconds) => {
      await wait(milliseconds)

      return milliseconds * 2
    })

    expect(results).toEqual([60, 20, 40, 0])
  })

  it('gives no results for no items', async () => {
    expect(await mapWithLimit(4, [], async () => 1)).toEqual([])
  })

  it('rejects with the error the map gives', async () => {
    const failing = mapWithLimit(1, [1, 2], async (item) => {
      if (item === 1) {
        throw new Error('broken')
      }

      return item
    })

    await expect(failing).rejects.toThrow('broken')
  })

  it("rejects a limit that isn't a whole number of at least 1", async () => {
    await expect(mapWithLimit(0, [1], async () => 1)).rejects.toThrow(RangeError)
    await expect(mapWithLimit(1.5, [1], async () => 1)).rejects.toThrow(RangeError)
  })
})
