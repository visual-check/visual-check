/**
 * One value per environment, with at least one side set. The `CI` environment variable picks the side. A missing side
 * takes the key's default, except for `url`, which has none: a run in that environment fails.
 *
 * @public
 */
export type LocalAndCi<T> = { local: T; ci?: T } | { local?: T; ci: T }

/**
 * Where the browser runs: a Linux container for either CPU architecture, or the host itself.
 *
 * @public
 */
export type Platform = 'linux/amd64' | 'linux/arm64' | 'host'

/**
 * The color scheme the browser emulates.
 *
 * @public
 */
export type ColorScheme = 'light' | 'dark'

/**
 * How much a snapshot may differ from its baseline before it fails.
 *
 * @public
 */
export interface Tolerance {
  /**
   * How far a pixel's color may move and still count as unchanged, from 0 to 1 (pixelmatch's threshold). Defaults to
   * `0.01`.
   */
  color?: number
  /**
   * How many pixels may differ. A whole number of 0 or more counts differing CSS pixels: at device scale factor `s` it
   * allows `⌊pixels × s²⌋` image pixels. A string from `'0%'` to `'100%'` is a share of the image's own pixels.
   * Defaults to `20`.
   */
  pixels?: number | `${number}%`
}

/**
 * The default capture's viewport for every story. `preview`, a meta or a story can override any part of it.
 *
 * @public
 */
export interface Viewport {
  /**
   * The width in CSS pixels. Defaults to `1280`.
   */
  width?: number
  /**
   * The height in CSS pixels. Defaults to `720`.
   */
  height?: number
  /**
   * The device pixel ratio. Defaults to `1`.
   */
  deviceScaleFactor?: number
  /**
   * Whether the browser emulates a touch device. Defaults to `false`.
   */
  touch?: boolean
}

/**
 * One Storybook the project captures.
 *
 * @public
 */
export interface StorybookSettings {
  /**
   * Where the running Storybook is served: an `http:` or `https:` URL, or a `{ local, ci }` pair of them. Required, with
   * no default.
   */
  url: string | LocalAndCi<string>
  /**
   * The folder Storybook runs in, relative to the config file's folder. `index.json`'s `importPath` is relative to it.
   * Defaults to the config file's folder. An absolute path works too.
   */
  dir?: string
  /**
   * Storybook's config folder, relative to `dir`. Defaults to `.storybook`. An absolute path works too.
   */
  configDir?: string
  /**
   * The folder that holds the baselines, relative to `dir`. Defaults to `.visual-check/baselines`. An absolute path
   * works too.
   */
  baselines?: string
}

/**
 * Which changed files select stories when only the affected stories run.
 *
 * @public
 */
export interface AffectedSettings {
  /**
   * Globs relative to the config file's folder. A changed file that matches selects every story. Defaults to `[]`.
   */
  selectAll?: string[]
  /**
   * Globs relative to the config file's folder. A changed file that matches selects nothing. Defaults to `[]`.
   */
  ignore?: string[]
}

/**
 * The shape of `visual-check.config.ts`.
 *
 * Only `storybooks.<name>.url`, `workers` and `readyTimeout` take a `{ local, ci }` pair. Nothing that changes pixels
 * can differ between a local run and CI.
 *
 * @public
 */
export interface Config {
  /**
   * The Storybooks to capture, by name. At least one entry. A name takes lowercase letters, digits and `-`.
   */
  storybooks: Record<string, StorybookSettings>
  /**
   * Where the browser runs. Defaults to `'linux/amd64'`.
   */
  platform?: Platform
  /**
   * The Docker image the browser runs in. Defaults to the browser package's image. A custom image must be built
   * `FROM` it.
   */
  image?: string
  /**
   * The project's default tolerance, which `preview`, a meta or a story can override. Defaults to
   * `{ color: 0.01, pixels: 20 }`.
   */
  tolerance?: Tolerance
  /**
   * The project's default viewport, which `preview`, a meta or a story can override. Defaults to
   * `{ width: 1280, height: 720, deviceScaleFactor: 1 }`, with `touch` off.
   */
  viewport?: Viewport
  /**
   * The color that paints masked regions, as `#RGB` or `#RRGGBB`. Defaults to `'#FF00FF'`.
   */
  maskColor?: string
  /**
   * The timezone the browser emulates, an IANA name such as `'Europe/Warsaw'`. Defaults to `'UTC'`.
   */
  timezone?: string
  /**
   * The locale the browser emulates, a BCP 47 tag such as `'en-US'`. Defaults to `'en-US'`.
   */
  locale?: string
  /**
   * The color scheme the browser emulates. Defaults to `'light'`.
   */
  colorScheme?: ColorScheme
  /**
   * The size of the one worker pool for the whole run: a number, `'auto'`, or a `{ local, ci }` pair. Defaults to
   * `'auto'`.
   */
  workers?: 'auto' | number | LocalAndCi<'auto' | number>
  /**
   * How long to wait for a story to be ready, in milliseconds: a number, or a `{ local, ci }` pair. Defaults to
   * `10_000`.
   */
  readyTimeout?: number | LocalAndCi<number>
  /**
   * How many more times a failing snapshot is captured before it fails. Defaults to `1`.
   */
  retries?: number
  /**
   * Exact hosts or `*.example.com` patterns. `update`'s end-of-run warnings about requests to these hosts (real network
   * requests and remote content) stay silent. Defaults to `[]`.
   */
  silenceHosts?: string[]
  /**
   * Which changed files select every story or none. Defaults to no globs.
   */
  affected?: AffectedSettings
}

/**
 * Returns the config unchanged. It exists so the editor and the type checker know the shape of the config.
 *
 * @public
 */
export function defineConfig(config: Config): Config {
  return config
}
