import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * The generic font families, each of which the browser maps to a font through its font table.
 */
const genericFamilies = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']

/**
 * One line of sample text in each generic font family, labelled with the family's name.
 */
function FontFamilies() {
  return (
    <div>
      {genericFamilies.map((family) => (
        <p key={family} style={{ margin: '0 0 12px', fontFamily: family, fontSize: 24 }}>
          {family}: The quick brown fox jumps over the lazy dog 0123456789
        </p>
      ))}
    </div>
  )
}

const meta = {
  title: 'Typography',
  component: FontFamilies,
} satisfies Meta<typeof FontFamilies>

export default meta

type Story = StoryObj<typeof meta>

export const GenericFamilies: Story = {}
