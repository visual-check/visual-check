/**
 * Which shard a test run is: one of several CI jobs the run is split across, each capturing its own share of the
 * stories files. `--shard 2/4` is the second of four.
 *
 * @public
 */
export interface Shard {
  /**
   * Which shard this is, from 1 to `total`. Nothing past the command line checks that it is in range.
   */
  index: number
  /**
   * How many shards the run is split across.
   */
  total: number
}
