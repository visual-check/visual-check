import { describe, expect, it } from 'vitest'
import { allowedPixels, checkDecodable, compareImages, pixelsMessage, sizeMessage } from './diff-thread.js'
import { decodePng, greyPng, pixelAt, whitePixels } from './images.fixture.js'

/**
 * The default tolerance.
 */
const defaults = { color: 0.01, pixels: 20 } as const

describe('allowedPixels', () => {
  it.each([
    [20, 1, 20],
    [20, 1.5, 45],
    [20, 2, 80],
    [20, 1.1, 24],
    [0, 3, 0],
  ] as const)('allows %s CSS pixels at scale %s as %s image pixels', (pixels, scale, expected) => {
    expect(allowedPixels(pixels, scale, 1000)).toBe(expected)
  })

  it.each([
    ['0.1%', 1280 * 720, 921],
    ['0.07%', 10_000, 7],
    ['51.25%', 3840 * 16_384, 32_243_712],
    ['100%', 6, 6],
    ['0%', 6, 0],
  ] as const)('allows %s of %s image pixels as %s, unscaled', (pixels, imagePixels, expected) => {
    expect(allowedPixels(pixels, 2, imagePixels)).toBe(expected)
  })
})

describe('pixelsMessage', () => {
  it('shows a count at scale 1 alone', () => {
    expect(pixelsMessage(84, 20, 20, 1)).toBe('84 differ, 20 allowed')
  })

  it('shows a count at another scale with its scale', () => {
    expect(pixelsMessage(84, 80, 20, 2)).toBe('84 differ, 80 allowed (20 at scale 2)')
  })

  it('shows a share as written', () => {
    expect(pixelsMessage(1000, 921, '0.1%', 2)).toBe('1000 differ, 921 allowed (0.1%)')
  })
})

describe('sizeMessage', () => {
  it('shows the baseline size, then the snapshot size', () => {
    expect(sizeMessage({ width: 1280, height: 2400 }, { width: 1280, height: 2432 })).toBe(
      'size changed: 1280×2400 → 1280×2432',
    )
  })
})

describe('compareImages', () => {
  it('fails one differing pixel at pixels 0 and draws it magenta over a faded baseline', async () => {
    const baseline = await greyPng(4, 3, 128)
    const snapshot = await greyPng(4, 3, 128, [{ x: 2, y: 1, rgba: [0, 0, 0, 255] }])

    const result = await compareImages({ baseline, snapshot, tolerance: { ...defaults, pixels: 0 }, scale: 1 })

    expect(result).toMatchObject({
      outcome: 'differs',
      reason: 'pixels',
      message: '1 differ, 0 allowed',
      differ: 1,
      allowed: 0,
      baselineSize: { width: 4, height: 3 },
      snapshotSize: { width: 4, height: 3 },
    })

    const diff = await decodePng((result as { diff: Uint8Array }).diff)

    expect([diff.width, diff.height]).toEqual([4, 3])
    expect(pixelAt(diff.pixels, 4, 2, 1)).toEqual([255, 45, 135, 255])
    expect(pixelAt(diff.pixels, 4, 0, 0)).toEqual([242, 242, 242, 255])
  })

  it('passes one differing pixel at pixels 20', async () => {
    const baseline = await greyPng(4, 3, 128)
    const snapshot = await greyPng(4, 3, 128, [{ x: 2, y: 1, rgba: [0, 0, 0, 255] }])

    expect(await compareImages({ baseline, snapshot, tolerance: defaults, scale: 1 })).toEqual({ outcome: 'passed' })
  })

  it.each([1, 2])('passes a grey shift of %s/255 at color 0.01 and fails it at color 0', async (shift) => {
    const baseline = await greyPng(4, 4, 128)
    const snapshot = await greyPng(4, 4, 128 + shift)
    const strict = { color: 0, pixels: 0 }

    expect(await compareImages({ baseline, snapshot, tolerance: { ...strict, color: 0.01 }, scale: 1 })).toEqual({
      outcome: 'passed',
    })
    expect(await compareImages({ baseline, snapshot, tolerance: strict, scale: 1 })).toMatchObject({
      outcome: 'differs',
      message: '16 differ, 0 allowed',
    })
  })

  it('passes 80 differing pixels at pixels 20 and scale 2, and fails 81', async () => {
    const baseline = await greyPng(20, 10, 128)
    const within = await greyPng(20, 10, 128, whitePixels(80, 20))
    const beyond = await greyPng(20, 10, 128, whitePixels(81, 20))

    expect(await compareImages({ baseline, snapshot: within, tolerance: defaults, scale: 2 })).toEqual({
      outcome: 'passed',
    })
    expect(await compareImages({ baseline, snapshot: beyond, tolerance: defaults, scale: 2 })).toMatchObject({
      outcome: 'differs',
      reason: 'pixels',
      message: '81 differ, 80 allowed (20 at scale 2)',
    })
  })

  it('fails a size difference whatever the budget, padding the diff in cyan', async () => {
    const baseline = await greyPng(2, 2, 128)
    const snapshot = await greyPng(2, 3, 128, [{ x: 0, y: 0, rgba: [0, 0, 0, 255] }])

    const result = await compareImages({ baseline, snapshot, tolerance: { ...defaults, pixels: '100%' }, scale: 1 })

    expect(result).toMatchObject({
      outcome: 'differs',
      reason: 'size',
      message: 'size changed: 2×2 → 2×3',
      differ: 3,
      baselineSize: { width: 2, height: 2 },
      snapshotSize: { width: 2, height: 3 },
    })

    const diff = await decodePng((result as { diff: Uint8Array }).diff)

    expect([diff.width, diff.height]).toEqual([2, 3])
    expect(pixelAt(diff.pixels, 2, 0, 0)).toEqual([255, 45, 135, 255])
    expect(pixelAt(diff.pixels, 2, 1, 1)).toEqual([242, 242, 242, 255])
    expect(pixelAt(diff.pixels, 2, 0, 2)).toEqual([0, 180, 216, 255])
    expect(pixelAt(diff.pixels, 2, 1, 2)).toEqual([0, 180, 216, 255])
  })

  it('pads both a wider baseline and a taller snapshot to the larger of each', async () => {
    const baseline = await greyPng(3, 1, 128)
    const snapshot = await greyPng(2, 2, 128)

    const result = await compareImages({ baseline, snapshot, tolerance: defaults, scale: 1 })

    expect(result).toMatchObject({ reason: 'size', message: 'size changed: 3×1 → 2×2', differ: 4 })

    const diff = await decodePng((result as { diff: Uint8Array }).diff)

    expect([diff.width, diff.height]).toEqual([3, 2])
    expect(pixelAt(diff.pixels, 3, 2, 0)).toEqual([0, 180, 216, 255])
    expect(pixelAt(diff.pixels, 3, 2, 1)).toEqual([0, 180, 216, 255])
  })

  it.each([
    ['baseline', 'snapshot'],
    ['snapshot', 'baseline'],
  ] as const)('says the %s is undecodable', async (broken, decodable) => {
    const images = { [broken]: Uint8Array.of(1, 2, 3), [decodable]: await greyPng(2, 2, 128) } as Record<
      'baseline' | 'snapshot',
      Uint8Array
    >

    expect(await compareImages({ ...images, tolerance: defaults, scale: 1 })).toMatchObject({
      outcome: 'undecodable',
      image: broken,
      reason: expect.any(String),
    })
  })
})

describe('checkDecodable', () => {
  it('says a PNG file decodes', async () => {
    expect(await checkDecodable(await greyPng(4, 4, 128))).toEqual({ outcome: 'decodable' })
  })

  it("gives the decoder's reason for a file that isn't a PNG file", async () => {
    expect(await checkDecodable(new TextEncoder().encode('not a PNG file'))).toEqual({
      outcome: 'undecodable',
      image: 'baseline',
      reason: 'Input buffer contains unsupported image format',
    })
  })
})
