import { describe, expect, it } from 'vitest'
import { imagesPath, imageUrlOf, isImageUrl, readImageUrl } from './image-url.js'

describe('imageUrlOf', () => {
  it('gives a relative URL', () => {
    expect(imageUrlOf('click-1', 'diffs/web/button--primary.png')).toBe(
      '__visual-check/images/click-1/diffs/web/button--primary.png',
    )
  })

  it('encodes each segment', () => {
    expect(imageUrlOf('click 1', 'diffs/my web/a?b#c%d.png')).toBe(
      '__visual-check/images/click%201/diffs/my%20web/a%3Fb%23c%25d.png',
    )
  })
})

describe('readImageUrl', () => {
  it.each(['diffs/web/a.png', 'snapshots/my web/a--ü.baseline.png', 'diffs/web/a?b#c%d\\e.png'])(
    'reads what imageUrlOf gave: %s',
    (path) => {
      const url = imageUrlOf('click-1', path)

      for (const prefix of ['', '/', '/docs/', '/docs/storybook/']) {
        expect(readImageUrl(`${prefix}${url}`)).toEqual({ id: 'click-1', path })
        expect(readImageUrl(`${prefix}${url}?v=1#top`)).toEqual({ id: 'click-1', path })
        expect(isImageUrl(`${prefix}${url}`)).toBe(true)
      }
    },
  )

  it.each([
    '/',
    '/index.json',
    `/${imagesPath}`,
    `/x${imagesPath}/click-1/a.png`,
    `/index.json?at=/${imagesPath}/click-1/a.png`,
    `/index.json#/${imagesPath}/click-1/a.png`,
  ])("takes no URL outside the images' path: %s", (url) => {
    expect(readImageUrl(url)).toBeUndefined()
    expect(isImageUrl(url)).toBe(false)
  })

  it.each([
    '',
    'click-1',
    'click-1/',
    '/a.png',
    'click-1//a.png',
    'click-1/a.png/',
    'click-1/../a.png',
    'click-1/./a.png',
    'click-1/%2e%2e/a.png',
    'click-1/%2E./a.png',
    '../click-1/a.png',
    'click-1/%',
    'click-1/%ff.png',
  ])("takes no URL under the images' path that imageUrlOf can't have made: %s", (rest) => {
    expect(readImageUrl(`/${imagesPath}/${rest}`)).toBeUndefined()
    expect(isImageUrl(`/${imagesPath}/${rest}`)).toBe(true)
  })
})
