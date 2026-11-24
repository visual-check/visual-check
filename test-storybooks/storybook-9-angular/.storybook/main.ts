import type { StorybookConfig } from '@storybook/angular'
import { testStorybookConfig } from '../../storybook-10-angular/.storybook/test-storybook-config.ts'

/**
 * The shared config, checked against this Storybook version's config type.
 */
const config: StorybookConfig = testStorybookConfig(import.meta.url)

export default config
