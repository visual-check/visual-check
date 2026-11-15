import type { Meta, StoryObj } from '@storybook/react-vite'

// The file throws as the browser imports it, so loading it fails and both its stories are broken, `load-failed`.
// Storybook's indexer reads the exports without running the file, so `index.json` still lists them. The throw sits
// behind a `window` check only because an unconditional top-level throw would make the rest of the file unreachable,
// which Biome's `noUnreachable` rejects. Every browser has a `window`, so the check changes nothing there.
if (typeof window !== 'undefined') {
  throw new Error('visual-check: this stories file fails to load')
}

const meta = {
  title: 'Load Fails',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Broken, `load-failed`, since its file fails to load. It needs no baseline: visual-check breaks it before reading
 * one.
 */
export const First: Story = {
  render: () => <p>never shown</p>,
}

/**
 * Broken, `load-failed`, like `First`: every story of a file that fails to load is.
 */
export const Second: Story = {
  render: () => <p>never shown</p>,
}
