import type { StorybookConfig } from '@storybook/vue3-vite'
import { testStorybookConfig } from './test-storybook-config.ts'

/**
 * The shared config, checked against this Storybook version's config type.
 */
const config: StorybookConfig = testStorybookConfig(import.meta.url)

export default config
