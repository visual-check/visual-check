/**
 * The size of an image, in its own pixels.
 */
export interface Size {
  /**
   * The width.
   */
  width: number
  /**
   * The height.
   */
  height: number
}

/**
 * How a baseline and a snapshot lie on top of each other, in values of CSS.
 */
export interface ImageLayout {
  /**
   * The width of the area at the images' own size.
   */
  width: string
  /**
   * The aspect ratio of the area.
   */
  aspectRatio: string
  /**
   * The baseline's width, of the area's.
   */
  baselineWidth: string
  /**
   * The snapshot's width, of the area's.
   */
  snapshotWidth: string
}

/**
 * Lays a baseline and a snapshot out at one scale, both at the top left of an area as wide as the wider one and as tall
 * as the taller one, so a size difference shows as it is.
 */
export function layoutOf(baseline: Size, snapshot: Size): ImageLayout {
  const width = Math.max(baseline.width, snapshot.width)
  const height = Math.max(baseline.height, snapshot.height)

  return {
    width: `${width}px`,
    aspectRatio: `${width} / ${height}`,
    baselineWidth: `${(baseline.width / width) * 100}%`,
    snapshotWidth: `${(snapshot.width / width) * 100}%`,
  }
}
