import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/vue3-vite'
import { dedupedViteConfig } from '../../storybook-10-html/.storybook/deduped-vite-config.ts'

/**
 * The config of each Vue test Storybook, given the URL of its `.storybook/main.ts`: the stories in
 * `storybook-10-vue/stories/`, with the framework and Storybook installed in the test Storybook's own package.
 *
 * Storybook loads a framework given by its package name from where Storybook itself is installed, which in this
 * workspace finds whichever version pnpm hoisted, so the config gives the folder of the framework that `mainUrl`
 * resolves. Docgen is off: the stories hold no `.vue` file, and docgen would load `vue-component-meta`, which needs
 * TypeScript's JS API, which TypeScript 7 doesn't have.
 *
 * Storybook turns the stories' `storybook/test` imports into a global of its preview runtime, which Vite resolves from
 * the project root, the test Storybook's package folder. `resolve.dedupe` resolves `storybook` from there too, so the
 * grid parts the stories read from `storybook-10-react` import nothing from that package's install. It resolves `vue`
 * from there as well, so Storybook's renderer, the port in `@visual-check/storybook`'s build and the stories share one
 * Vue: with two copies, a decorator's `provide` wouldn't reach the grid's cells.
 *
 * @public
 */
export function testStorybookConfig(mainUrl: string): StorybookConfig {
  const require = createRequire(mainUrl)

  return {
    framework: { name: dirname(require.resolve('@storybook/vue3-vite/package.json')), options: { docgen: false } },
    stories: [{ directory: fileURLToPath(new URL('../stories', import.meta.url)), files: '*.stories.ts' }],
    core: { disableTelemetry: true },
    viteFinal: (viteConfig) => dedupedViteConfig(viteConfig, ['storybook', 'vue']),
  }
}
