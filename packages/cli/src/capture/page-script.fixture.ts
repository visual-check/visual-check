/**
 * Builds what the wait for images and fonts in the page answers once every image decoded and the fonts loaded.
 */
export function readyAnswer(): Record<string, unknown> {
  return { outcome: 'ready' }
}

/**
 * Builds what the wait for images and fonts in the page answers when its time limit passed while images decoded, with
 * `pending` images not yet complete. `pending` can be a value the page never gives, to test how it's read.
 */
export function imagesTimedOutAnswer(pending: unknown): Record<string, unknown> {
  return { outcome: 'timed-out', step: 'images', pending }
}

/**
 * Builds what the wait for images and fonts in the page answers when its time limit passed while fonts loaded, with
 * the faces still loading. `pendingFaces` can be a value the page never gives, to test how it's read.
 */
export function fontsTimedOutAnswer(pendingFaces: unknown): Record<string, unknown> {
  return { outcome: 'timed-out', step: 'fonts', pendingFaces }
}
