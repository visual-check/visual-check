/**
 * The part of a Vite config `dedupedViteConfig` reads and changes.
 */
interface DedupeConfig {
  /**
   * How Vite resolves imports.
   */
  resolve?:
    | {
        /**
         * The packages Vite always resolves from the project root.
         */
        dedupe?: string[] | undefined
      }
    | undefined
}

/**
 * A test Storybook's Vite config, with the packages also resolved from the project root, the test Storybook's package
 * folder, so stories and parts that another package holds import nothing from that package's install.
 *
 * @public
 */
export function dedupedViteConfig<Config extends DedupeConfig>(viteConfig: Config, packages: string[]): Config {
  return {
    ...viteConfig,
    resolve: {
      ...viteConfig.resolve,
      dedupe: [...(viteConfig.resolve?.dedupe ?? []), ...packages],
    },
  }
}
