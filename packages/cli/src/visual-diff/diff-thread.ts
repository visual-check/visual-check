// A thread of the visual diff's pool, and the comparison it runs. Node runs this file as it is, including as `.ts`
// under Vitest, where `./x.js` doesn't lead to `./x.ts`. So it imports packages only, and types, which Node strips.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import pixelmatch from 'pixelmatch'
import sharp from 'sharp'
import type { Tolerance } from '../config/define-config.js'
import type { ImageSize, ThreadReply, ThreadResult, ThreadTask, VisualDiffRequest } from './visual-diff.js'

/**
 * What the pool starts a thread with. It repeats the pool's own, because this file imports no file of its own.
 */
const threadMarker = 'visual-check:visual-diff'

/**
 * What a share or a scaled count may fall short of a whole pixel by and still round up to it, because floating
 * point gives `0.07% of 10000` as `6.999…` or `20 × 1.1²` as `24.2000…01`.
 */
const roundingSlack = 1e-9

/**
 * The colour of a differing pixel in the visual diff: magenta `#FF2D87`.
 */
const differingColor: [number, number, number] = [255, 45, 135]

/**
 * The colour of the padding in the visual diff of a size difference: cyan `#00B4D8`.
 */
const paddingColor = { r: 0, g: 180, b: 216, alpha: 1 }

/**
 * A decoded image: its size and its pixels, 4 bytes each in RGBA order.
 */
interface DecodedImage extends ImageSize {
  /**
   * The pixels, row by row.
   */
  pixels: Uint8Array
}

/**
 * Gives how many differing image pixels `pixels` allows, rounded down. A count is in CSS pixels, so it scales with
 * the square of the device scale factor `scale`. A share, such as `'0.1%'`, is of the image's own `imagePixels`.
 */
export function allowedPixels(pixels: Required<Tolerance>['pixels'], scale: number, imagePixels: number): number {
  const exact = typeof pixels === 'number' ? pixels * scale * scale : (Number.parseFloat(pixels) * imagePixels) / 100

  return Math.floor(exact + roundingSlack)
}

/**
 * Says how many image pixels differ against how many are allowed, such as `84 differ, 80 allowed (20 at scale 2)`.
 * The budget shows as written: a count with its scale when that isn't 1, and a share always.
 */
export function pixelsMessage(
  differ: number,
  allowed: number,
  pixels: Required<Tolerance>['pixels'],
  scale: number,
): string {
  const counts = `${differ} differ, ${allowed} allowed`

  if (typeof pixels === 'string') {
    return `${counts} (${pixels})`
  }

  if (scale === 1) {
    return counts
  }

  return `${counts} (${pixels} at scale ${scale})`
}

/**
 * Says how the size changed from the baseline to the snapshot, such as `size changed: 1280×2400 → 1280×2432`.
 */
export function sizeMessage(baseline: ImageSize, snapshot: ImageSize): string {
  return `size changed: ${baseline.width}×${baseline.height} → ${snapshot.width}×${snapshot.height}`
}

/**
 * Gives an error's message, or any other thrown value as text.
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Decodes a PNG file to sRGB pixels of 4 bytes each in RGBA order, adding an opaque alpha channel when the file has
 * none.
 *
 * @throws {Error} When the file can't be decoded, or decodes to another layout.
 */
async function decode(file: Uint8Array): Promise<DecodedImage> {
  const { data, info } = await sharp(file)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })

  if (info.channels !== 4) {
    throw new Error(`It decodes to ${info.channels} channels instead of 4`)
  }

  // pixelmatch reads the pixels as 32-bit words, which need a start on a multiple of 4 bytes.
  const pixels = data.byteOffset % 4 === 0 ? data : new Uint8Array(data)

  return { width: info.width, height: info.height, pixels }
}

/**
 * Gives the top left `inner` part of `image`, which is `image`'s own pixels when it's that size already.
 */
function crop(image: DecodedImage, inner: ImageSize): Uint8Array {
  if (image.width === inner.width && image.height === inner.height) {
    return image.pixels
  }

  const part = new Uint8Array(inner.width * inner.height * 4)

  for (let row = 0; row < inner.height; row += 1) {
    const start = row * image.width * 4

    part.set(image.pixels.subarray(start, start + inner.width * 4), row * inner.width * 4)
  }

  return part
}

/**
 * Encodes RGBA pixels of `size` as a PNG file, padded in cyan on the right and the bottom up to `padded`.
 */
async function encode(pixels: Uint8Array, size: ImageSize, padded: ImageSize): Promise<Uint8Array> {
  return sharp(pixels, { raw: { width: size.width, height: size.height, channels: 4 } })
    .extend({
      right: padded.width - size.width,
      bottom: padded.height - size.height,
      background: paddingColor,
    })
    .png()
    .toBuffer()
}

/**
 * Compares a snapshot with its baseline by the tolerance, and draws the visual diff only when they differ: differing
 * pixels in magenta over a faded baseline. Images of different sizes always differ. Their visual diff is padded to the
 * larger width and height, and the padding is cyan and counts as differing.
 */
export async function compareImages(request: VisualDiffRequest): Promise<ThreadResult> {
  const [baseline, snapshot] = await Promise.allSettled([decode(request.baseline), decode(request.snapshot)])

  if (baseline.status === 'rejected') {
    return { outcome: 'undecodable', image: 'baseline', reason: reasonOf(baseline.reason) }
  }

  if (snapshot.status === 'rejected') {
    return { outcome: 'undecodable', image: 'snapshot', reason: reasonOf(snapshot.reason) }
  }

  const before = baseline.value
  const after = snapshot.value
  const baselineSize = { width: before.width, height: before.height }
  const snapshotSize = { width: after.width, height: after.height }
  const inner = { width: Math.min(before.width, after.width), height: Math.min(before.height, after.height) }
  const outer = { width: Math.max(before.width, after.width), height: Math.max(before.height, after.height) }
  const padding = outer.width * outer.height - inner.width * inner.height
  const sizeChanged = padding > 0
  const allowed = allowedPixels(request.tolerance.pixels, request.scale, outer.width * outer.height)
  const options = { threshold: request.tolerance.color, includeAA: true }

  // Both images are cropped to the part they share, which is all of them when their sizes are equal.
  const sharedBaseline = crop(before, inner)
  const sharedSnapshot = crop(after, inner)

  if (!sizeChanged) {
    const differ = pixelmatch(sharedBaseline, sharedSnapshot, null, inner.width, inner.height, options)

    if (differ <= allowed) {
      return { outcome: 'passed' }
    }
  }

  const output = new Uint8Array(inner.width * inner.height * 4)
  const differInside = pixelmatch(sharedBaseline, sharedSnapshot, output, inner.width, inner.height, {
    ...options,
    diffColor: differingColor,
  })
  const differ = differInside + padding

  return {
    outcome: 'differs',
    reason: sizeChanged ? 'size' : 'pixels',
    message: sizeChanged
      ? sizeMessage(baselineSize, snapshotSize)
      : pixelsMessage(differ, allowed, request.tolerance.pixels, request.scale),
    differ,
    allowed,
    baselineSize,
    snapshotSize,
    diff: await encode(output, inner, outer),
  }
}

/**
 * Decodes a baseline as a comparison decodes it, to check that it can be.
 */
export async function checkDecodable(file: Uint8Array): Promise<ThreadResult> {
  try {
    await decode(file)

    return { outcome: 'decodable' }
  } catch (error) {
    return { outcome: 'undecodable', image: 'baseline', reason: reasonOf(error) }
  }
}

/**
 * Runs one task the pool sent: a comparison or a decode check.
 */
async function runTask(task: ThreadTask): Promise<ThreadResult> {
  return task.kind === 'compare' ? await compareImages(task.request) : await checkDecodable(task.file)
}

if (!isMainThread && workerData === threadMarker && parentPort !== null) {
  const port = parentPort

  // Each file is decoded once, so sharp's cache only holds memory.
  sharp.cache(false)

  // Each reply is copied back: sharp's buffers can't be moved to another thread.
  port.on('message', async (task: ThreadTask) => {
    try {
      port.postMessage({ result: await runTask(task) } satisfies ThreadReply)
    } catch (error) {
      port.postMessage({ error: reasonOf(error) } satisfies ThreadReply)
    }
  })
}
