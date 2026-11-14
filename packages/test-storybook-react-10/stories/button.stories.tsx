import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * What a button shows and how it looks.
 */
interface ButtonProps {
  /**
   * The button's text.
   */
  label: string
  /**
   * The look: filled for the main action, outlined for the others.
   */
  variant: 'primary' | 'secondary'
}

/**
 * A plain button in one of two variants.
 */
function Button({ label, variant }: ButtonProps) {
  const primary = variant === 'primary'

  return (
    <button
      type="button"
      style={{
        padding: '8px 16px',
        border: '2px solid #1d4ed8',
        borderRadius: 6,
        background: primary ? '#1d4ed8' : '#ffffff',
        color: primary ? '#ffffff' : '#1d4ed8',
        fontFamily: 'sans-serif',
        fontSize: 16,
      }}
    >
      {label}
    </button>
  )
}

const meta = {
  title: 'Button',
  component: Button,
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: { label: 'Save changes', variant: 'primary' },
}

export const Secondary: Story = {
  args: { label: 'Cancel', variant: 'secondary' },
}
