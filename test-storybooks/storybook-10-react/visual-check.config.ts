import { defineConfig } from '@visual-check/cli'

/**
 * The browser image to run in. Until the browser image is published, the browser package names a placeholder digest,
 * so every run names a locally built image through `TEST_STORYBOOK_IMAGE`.
 */
const image = process.env.TEST_STORYBOOK_IMAGE

export default defineConfig({
  storybooks: {
    react: { url: 'http://127.0.0.1:6006' },
  },
  ...(image ? { image } : {}),
})
