import type { StorybookConfig } from '@storybook/react-vite'
import { testStorybookConfig } from './test-storybook-config.ts'

/**
 * The config each React test Storybook shares.
 */
const shared = testStorybookConfig(import.meta.url)

/**
 * The shared config, with visual-check's addon, which is for Storybook 10 alone.
 */
const config: StorybookConfig = {
  ...shared,
  addons: [...(shared.addons ?? []), '@visual-check/storybook-addon'],
}

export default config
