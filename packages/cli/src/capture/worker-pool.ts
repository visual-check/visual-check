/**
 * One GiB, in bytes.
 */
const gibibyte = 2 ** 30

/**
 * The CPUs and memory where the browser runs, which `workers: 'auto'` is worked out from: Docker's engine for
 * visual-check's container, or the machine itself inside visual-check's image.
 *
 * @public
 */
export interface BrowserHost {
  /**
   * How many CPUs it has.
   */
  cpus: number
  /**
   * How much memory it has, in bytes.
   */
  memoryBytes: number
}

/**
 * Gives how many workers `workers: 'auto'` runs for a machine: the smaller of its CPU count and its memory beyond
 * the first GiB, and never fewer than one. The memory is rounded to the nearest GiB first, because a VM reports a
 * little less than its size: OrbStack set to 12 GiB reports 11.73 GiB.
 *
 * @public
 */
export function autoWorkerCount(host: BrowserHost): number {
  return Math.max(1, Math.min(host.cpus, Math.round(host.memoryBytes / gibibyte) - 1))
}

/**
 * Runs `work` for every item with up to `workers` running at once. Each worker takes the next item in order until
 * none are left, and never runs two at once. `worker` is the worker's number, from 0. After the first error no worker
 * takes another item.
 *
 * @public
 * @throws {RangeError} When `workers` isn't a whole number of at least 1.
 * @throws {Error} The first error `work` threw, once the work in flight has settled.
 */
export async function runWorkerPool<T>(
  workers: number,
  items: readonly T[],
  work: (item: T, index: number, worker: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new RangeError(`workers must be a whole number of at least 1, but it is ${workers}.`)
  }

  let next = 0
  let failed = false
  let firstError: unknown

  const run = async (worker: number): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next

      next += 1

      try {
        await work(items[index] as T, index, worker)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, (_, worker) => run(worker)))

  if (failed) {
    throw firstError
  }
}
