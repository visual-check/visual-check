import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * What a card shows.
 */
interface CardProps {
  /**
   * The card's heading.
   */
  title: string
  /**
   * The text under the heading.
   */
  body: string
}

/**
 * A bordered card with a heading and a paragraph. Its `card` class is the only one in this Storybook: the end-to-end
 * check styles it to make its deliberate change.
 */
function Card({ title, body }: CardProps) {
  return (
    <article
      className="card"
      style={{
        width: 320,
        padding: 16,
        border: '1px solid #d4d4d8',
        borderRadius: 8,
        background: '#fafafa',
        fontFamily: 'sans-serif',
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{body}</p>
    </article>
  )
}

const meta = {
  title: 'Card',
  component: Card,
} satisfies Meta<typeof Card>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'Release notes',
    body: 'Snapshots are compared with their baselines byte for byte, and every story is captured in one browser.',
  },
}
