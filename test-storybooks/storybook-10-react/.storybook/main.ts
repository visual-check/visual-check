import type { StorybookConfig } from '@storybook/react-vite'
import { testStorybookConfig } from './test-storybook-config.ts'

/**
 * The config each React test Storybook shares, with visual-check's addon, which is for Storybook 10 alone.
 */
const config: StorybookConfig = {
  ...testStorybookConfig(import.meta.url),
  addons: ['@visual-check/storybook-addon'],
}

export default config
