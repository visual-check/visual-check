import type { StorybookConfig } from '@storybook/react-vite'
import { testStorybookConfig } from './test-storybook-config.ts'

/**
 * The config each React test Storybook shares.
 */
const config: StorybookConfig = testStorybookConfig(import.meta.url)

export default config
