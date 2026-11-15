import sharp from 'sharp'

/**
 * One pixel to set in a test image, in RGBA.
 *
 * @public
 */
export interface PixelChange {
  /**
   * The pixel's column, from 0.
   */
  x: number
  /**
   * The pixel's row, from 0.
   */
  y: number
  /**
   * The pixel's colour, as red, green, blue and alpha from 0 to 255.
   */
  rgba: [number, number, number, number]
}

/**
 * Makes an opaque PNG file of `width` × `height` pixels in the grey `grey`, with `changes` set on top.
 *
 * @public
 */
export async function greyPng(
  width: number,
  height: number,
  grey: number,
  changes: readonly PixelChange[] = [],
): Promise<Uint8Array> {
  const pixels = new Uint8Array(width * height * 4)

  for (let index = 0; index < width * height; index += 1) {
    pixels.set([grey, grey, grey, 255], index * 4)
  }

  for (const change of changes) {
    pixels.set(change.rgba, (change.y * width + change.x) * 4)
  }

  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
}

/**
 * Encodes a PNG file again at another compression level: other bytes for the same pixels.
 */
export async function reencodePng(file: Uint8Array, compressionLevel: number): Promise<Uint8Array> {
  return sharp(file).png({ compressionLevel }).toBuffer()
}

/**
 * Makes `count` changes to white along the rows of an image `width` pixels wide, from the top left.
 *
 * @public
 */
export function whitePixels(count: number, width: number): PixelChange[] {
  return Array.from({ length: count }, (_, index) => ({
    x: index % width,
    y: Math.floor(index / width),
    rgba: [255, 255, 255, 255],
  }))
}

/**
 * Decodes a PNG file to its size and RGBA pixels.
 */
export async function decodePng(file: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  return { width: info.width, height: info.height, pixels: data }
}

/**
 * Gives the RGBA colour of the pixel at `x`, `y` of decoded pixels `width` wide.
 */
export function pixelAt(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const start = (y * width + x) * 4

  return [...pixels.subarray(start, start + 4)]
}
