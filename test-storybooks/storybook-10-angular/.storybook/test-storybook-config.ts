import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/angular'
import { ownModulesFirst } from './own-modules-first.ts'

/**
 * The config of each Angular test Storybook, given the URL of its `.storybook/main.ts`: the stories in
 * `storybook-10-angular/stories/`, with the framework and Storybook installed in the test Storybook's own package.
 *
 * Each Angular test Storybook runs through the Angular CLI's builder (`ng run`), as Storybook's Angular framework
 * requires when the CLI's build package is installed, with the builder's options in its `angular.json`: zoneless, no
 * compodoc, and the stories compiled with `.storybook/tsconfig.json`.
 *
 * Storybook loads a framework given by its package name from where Storybook itself is installed, which in this
 * workspace finds whichever version pnpm hoisted, so the config gives the folder of the framework that `mainUrl`
 * resolves.
 *
 * Webpack looks for packages in the test Storybook's own `node_modules` first, so Storybook's renderer, the port in
 * `@visual-check/storybook`'s build, the stories and the grid parts they read from `storybook-10-react` share one
 * Angular and one Storybook: with two copies of Angular, the meta's providers wouldn't reach the grid's cells.
 *
 * @public
 */
export function testStorybookConfig(mainUrl: string): StorybookConfig {
  const require = createRequire(mainUrl)
  const nodeModules = fileURLToPath(new URL('../node_modules', mainUrl))

  return {
    framework: { name: dirname(require.resolve('@storybook/angular/package.json')), options: {} },
    stories: [{ directory: fileURLToPath(new URL('../stories', import.meta.url)), files: '*.stories.ts' }],
    core: { disableTelemetry: true },
    webpackFinal: (webpackConfig) => ownModulesFirst(webpackConfig, nodeModules),
  }
}
