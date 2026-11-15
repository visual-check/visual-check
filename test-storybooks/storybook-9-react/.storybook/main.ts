import type { StorybookConfig } from '@storybook/react-vite'
import { testStorybookConfig } from '../../storybook-10-react/.storybook/test-storybook-config.ts'

/**
 * The shared config, checked against this Storybook version's config type.
 */
const config: StorybookConfig = testStorybookConfig(import.meta.url)

export default config
