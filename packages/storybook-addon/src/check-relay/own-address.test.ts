import { describe, expect, it } from 'vitest'
import { ownAddressOf } from './own-address.js'

describe('ownAddressOf', () => {
  it.each([
    { options: { port: 6006 }, address: 'http://127.0.0.1:6006' },
    { options: { port: 6006, host: '' }, address: 'http://127.0.0.1:6006' },
    { options: { port: 6006, host: '0.0.0.0' }, address: 'http://127.0.0.1:6006' },
    { options: { port: 6006, host: '::' }, address: 'http://127.0.0.1:6006' },
    { options: { port: 6007, host: 'storybook.test' }, address: 'http://storybook.test:6007' },
    { options: { port: 6006, host: '192.168.1.2' }, address: 'http://192.168.1.2:6006' },
    { options: { port: 6006, host: '::1' }, address: 'http://[::1]:6006' },
    { options: { port: 6006, host: 'fd00::2' }, address: 'http://[fd00::2]:6006' },
    { options: { port: 6006, https: false }, address: 'http://127.0.0.1:6006' },
    { options: { port: 6006, https: true }, address: 'https://localhost:6006' },
    { options: { port: 6006, https: true, host: '0.0.0.0' }, address: 'https://localhost:6006' },
    { options: { port: 6006, https: true, host: '::' }, address: 'https://localhost:6006' },
    { options: { port: 6006, https: true, host: 'storybook.test' }, address: 'https://storybook.test:6006' },
    { options: {}, address: 'http://127.0.0.1' },
  ])('gives $address for $options', ({ options, address }) => {
    expect(ownAddressOf(options)).toBe(address)
  })
})
