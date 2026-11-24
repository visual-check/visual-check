import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/html-vite'

/**
 * The config of each plain-DOM test Storybook, given the URL of its `.storybook/main.ts`: the stories in
 * `storybook-10-html/stories/`, with the framework and Storybook installed in the test Storybook's own package.
 *
 * Storybook loads a framework given by its package name from where Storybook itself is installed, which in this
 * workspace finds whichever version pnpm hoisted, so the config gives the folder of the framework that `mainUrl`
 * resolves.
 *
 * Storybook turns the stories' `storybook/test` imports into a global of its preview runtime, which Vite resolves from
 * the project root, the test Storybook's package folder. `resolve.dedupe` resolves `storybook` from there too, so the
 * grid parts the stories read from `storybook-10-react` import nothing from that package's install.
 *
 * @public
 */
export function testStorybookConfig(mainUrl: string): StorybookConfig {
  const require = createRequire(mainUrl)

  return {
    framework: dirname(require.resolve('@storybook/html-vite/package.json')),
    stories: [{ directory: fileURLToPath(new URL('../stories', import.meta.url)), files: '*.stories.ts' }],
    core: { disableTelemetry: true },
    viteFinal: (viteConfig) => ({
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        dedupe: [...(viteConfig.resolve?.dedupe ?? []), 'storybook'],
      },
    }),
  }
}
