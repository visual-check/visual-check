import type { StorybookConfig } from '@storybook/html-vite'
import { testStorybookConfig } from '../../storybook-10-html/.storybook/test-storybook-config.ts'

/**
 * The shared config, checked against this Storybook version's config type.
 */
const config: StorybookConfig = testStorybookConfig(import.meta.url)

export default config
