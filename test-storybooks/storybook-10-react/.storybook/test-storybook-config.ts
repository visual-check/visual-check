import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'

/**
 * The config of each React test Storybook, given the URL of its `.storybook/main.ts`: the stories in
 * `storybook-10-react/stories/`, with the framework, React and Storybook installed in the test Storybook's own package.
 *
 * Storybook loads a framework given by its package name from where Storybook itself is installed, which in this
 * workspace finds whichever version pnpm hoisted, so the config gives the folder of the framework that `mainUrl`
 * resolves.
 *
 * Storybook turns the stories' `storybook/test` imports into a global of its preview runtime, which Vite resolves from
 * the project root, the test Storybook's package folder. `resolve.dedupe` resolves React and anything else from
 * `storybook` from there too, so stories that another package reads import nothing from this package's install.
 *
 * Every test Storybook's preview also loads `storybook-10-react/.storybook/shared-preview.ts`, which sets the
 * preview-level `parameters.visualCheck`. It isn't named `preview.ts`, so Storybook loads it only through
 * `previewAnnotations`.
 *
 * @public
 */
export function testStorybookConfig(mainUrl: string): StorybookConfig {
  return {
    framework: dirname(createRequire(mainUrl).resolve('@storybook/react-vite/package.json')),
    stories: [{ directory: fileURLToPath(new URL('../stories', import.meta.url)), files: '*.stories.tsx' }],
    previewAnnotations: (entries = []) => [...entries, fileURLToPath(new URL('./shared-preview.ts', import.meta.url))],
    core: { disableTelemetry: true },
    viteFinal: (viteConfig) => ({
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        dedupe: [...(viteConfig.resolve?.dedupe ?? []), 'react', 'react-dom', 'storybook'],
      },
    }),
  }
}
