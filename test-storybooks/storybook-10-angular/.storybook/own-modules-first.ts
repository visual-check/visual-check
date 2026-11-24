/**
 * The part of a webpack config `ownModulesFirst` reads and changes.
 */
interface ModulesConfig {
  /**
   * How webpack resolves imports.
   */
  resolve?:
    | {
        /**
         * The folders webpack looks for packages in, in order: a relative name is looked up in every ancestor folder,
         * an absolute path as is.
         */
        modules?: string[] | undefined
      }
    | undefined
}

/**
 * A test Storybook's webpack config, looking for packages in the test Storybook's own `node_modules` first, so the
 * port in `@visual-check/storybook`'s build and the stories read from other packages resolve Angular, Storybook and
 * rxjs from this install: with two copies of Angular, the injector and `NgComponentOutlet` of one wouldn't know the
 * other's components and providers. The folder is listed once, and the rest of the config is unchanged.
 *
 * @public
 */
export function ownModulesFirst<Config extends ModulesConfig>(webpackConfig: Config, nodeModules: string): Config {
  const modules = webpackConfig.resolve?.modules ?? ['node_modules']

  return {
    ...webpackConfig,
    resolve: {
      ...webpackConfig.resolve,
      modules: [nodeModules, ...modules.filter((folder) => folder !== nodeModules)],
    },
  }
}
