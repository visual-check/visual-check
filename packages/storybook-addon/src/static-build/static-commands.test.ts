import { describe, expect, it } from 'vitest'
import { isLoopbackHost, staticCommandsOf, storybookAddressOf } from './static-commands.js'

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', 'localhost', 'LocalHost', '::1', '[::1]'])('takes %s for a loopback host', (hostname) => {
    expect(isLoopbackHost(hostname)).toBe(true)
  })

  it.each(['127.0.0.2', 'example.com', '192.168.1.20', 'localhost.example.com', ''])(
    "doesn't take %s for one",
    (hostname) => {
      expect(isLoopbackHost(hostname)).toBe(false)
    },
  )
})

describe('storybookAddressOf', () => {
  it.each([
    ['http://127.0.0.1:6006/?path=/story/card--default', 'http://127.0.0.1:6006'],
    ['http://127.0.0.1:6006/', 'http://127.0.0.1:6006'],
    ['http://127.0.0.1:8080/sb/index.html?path=/story/a--b', 'http://127.0.0.1:8080/sb'],
    ['http://localhost:8080/sb/', 'http://localhost:8080/sb'],
    ['http://[::1]:6006/iframe.html', 'http://[::1]:6006'],
  ])('gives the Storybook of %s at %s', (href, address) => {
    expect(storybookAddressOf(href)).toBe(address)
  })
})

describe('staticCommandsOf', () => {
  it("gives the PRD's commands", () => {
    expect(
      staticCommandsOf({ storybook: 'web', storyId: 'components-button--primary', address: 'http://127.0.0.1:6006' }),
    ).toEqual({
      test: "visual-check test --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006",
      update: "visual-check update --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006",
    })
  })

  it("escapes a story ID's regex characters and quotes its quotes", () => {
    const { test } = staticCommandsOf({ storybook: 'web', storyId: "a.b+c--it's", address: 'http://localhost:6006/sb' })

    expect(test).toBe(
      String.raw`visual-check test --storybook web --filter '^a\.b\+c--it'\''s$' --url http://localhost:6006/sb`,
    )
  })

  it('quotes an address a shell would read otherwise', () => {
    const { update } = staticCommandsOf({ storybook: 'web', storyId: 'a--b', address: 'http://[::1]:6006' })

    expect(update).toBe("visual-check update --storybook web --filter '^a--b$' --url 'http://[::1]:6006'")
  })
})
