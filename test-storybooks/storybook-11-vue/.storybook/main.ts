import type { StorybookConfig } from '@storybook/vue3-vite'
import { testStorybookConfig } from '../../storybook-10-vue/.storybook/test-storybook-config.ts'

/**
 * The shared config, checked against this Storybook version's config type.
 */
const config: StorybookConfig = testStorybookConfig(import.meta.url)

export default config
