import { describe, expect, it } from 'vitest'
import { autoWorkerCount, runWorkerPool } from './worker-pool.js'

/**
 * One GiB, in bytes.
 */
const gibibyte = 2 ** 30

/**
 * A promise whose settling the test controls.
 */
interface Deferred {
  /**
   * The promise.
   */
  promise: Promise<void>
  /**
   * Resolves the promise.
   */
  resolve: () => void
  /**
   * Rejects the promise with `error`.
   */
  reject: (error: Error) => void
}

/**
 * Makes a deferred promise.
 */
function deferred(): Deferred {
  let resolve: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

/**
 * Lets every pending promise callback run.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('autoWorkerCount', () => {
  it.each([
    ['a private repo hosted runner, 2 vCPU and 7 GB', { cpus: 2, memoryBytes: 7e9 }, 2],
    ['a public repo hosted runner, 4 vCPU and 16 GB', { cpus: 4, memoryBytes: 16e9 }, 4],
    ["Docker Desktop's default VM, 8 GiB", { cpus: 8, memoryBytes: 8 * gibibyte }, 7],
    ['OrbStack, 12 CPUs and 12 GiB', { cpus: 12, memoryBytes: 12 * gibibyte }, 11],
    ['OrbStack set to 12 GiB, as docker info reports it', { cpus: 12, memoryBytes: 12_599_218_176 }, 11],
    ['an 8 GiB VM that reports 7.65 GiB', { cpus: 8, memoryBytes: 8_214_000_000 }, 7],
    ['a machine bound by memory, 16 CPUs and 4 GiB', { cpus: 16, memoryBytes: 4 * gibibyte }, 3],
    ['a machine with under 2 GiB', { cpus: 4, memoryBytes: gibibyte / 2 }, 1],
  ])('gives %s its workers', (_name, host, expected) => {
    expect(autoWorkerCount(host)).toBe(expected)
  })
})

describe('runWorkerPool', () => {
  it('runs every item once, with its index', async () => {
    const seen: [string, number][] = []

    await runWorkerPool(2, ['a', 'b', 'c', 'd', 'e'], async (item, index) => {
      seen.push([item, index])
    })
    expect(seen.sort()).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
      ['e', 4],
    ])
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects %s workers with a RangeError', async (workers) => {
    await expect(runWorkerPool(workers, ['a'], async () => undefined)).rejects.toThrow(RangeError)
  })

  it('resolves without calling the work when there are no items', async () => {
    let calls = 0

    await runWorkerPool(3, [], async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })

  it('starts as many workers as there are items when they are fewer than the workers', async () => {
    const workers = new Set<number>()

    await runWorkerPool(5, ['a', 'b'], async (_item, _index, worker) => {
      workers.add(worker)
    })
    expect([...workers].sort()).toEqual([0, 1])
  })

  it('never runs more items at once than there are workers', async () => {
    const gates = Array.from({ length: 5 }, deferred)
    let running = 0
    let peak = 0
    const pool = runWorkerPool(2, gates, async (gate) => {
      running += 1
      peak = Math.max(peak, running)
      await gate.promise
      running -= 1
    })

    await settle()
    expect(running).toBe(2)

    for (const gate of gates) {
      gate.resolve()
      await settle()
    }

    await pool
    expect(peak).toBe(2)
  })

  it('takes items in order, each worker running one at a time', async () => {
    const gates = [deferred(), deferred(), deferred()]
    const started: [number, number][] = []
    const pool = runWorkerPool(2, gates, async (gate, index, worker) => {
      started.push([index, worker])
      await gate.promise
    })

    await settle()
    expect(started).toEqual([
      [0, 0],
      [1, 1],
    ])
    gates[1]?.resolve()
    await settle()
    expect(started).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
    ])
    gates[0]?.resolve()
    gates[2]?.resolve()
    await pool
  })

  it('takes no more items after the first error, waits for the work in flight and rejects with that error', async () => {
    const slow = deferred()
    const started: number[] = []
    let settled = false
    const pool = runWorkerPool(2, [0, 1, 2, 3], async (_item, index) => {
      started.push(index)

      if (index === 0) {
        await slow.promise
      } else {
        throw new Error('first')
      }
    }).finally(() => {
      settled = true
    })
    const outcome = expect(pool).rejects.toThrow('first')

    await settle()
    expect(settled).toBe(false)
    slow.resolve()
    await outcome
    expect(started).toEqual([0, 1])
  })

  it('rejects with the first error when several fail', async () => {
    const gates = [deferred(), deferred()]
    const pool = runWorkerPool(2, gates, async (gate) => {
      await gate.promise
    })
    const outcome = expect(pool).rejects.toThrow('one')

    await settle()
    gates[1]?.reject(new Error('one'))
    await settle()
    gates[0]?.reject(new Error('two'))
    await outcome
  })
})
