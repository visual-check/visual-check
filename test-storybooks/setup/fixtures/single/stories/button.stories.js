export default {
  title: 'Button',
}

export const Default = {
  render: () => {
    const button = document.createElement('button')

    button.type = 'button'
    button.textContent = 'Button'

    return button
  },
}
