import { describe, expect, it } from 'vitest'
import { changedPackagesOf } from './sorted-changes.js'

/**
 * A changed package.json in `packages/ui`, and an image in `packages/icons`.
 */
const packageScoped = [
  { file: 'packages/ui/package.json', packageFolder: 'packages/ui', asset: false },
  { file: 'packages/icons/star.svg', packageFolder: 'packages/icons', asset: true },
]

describe('changedPackagesOf', () => {
  it('counts no asset before the graph answers', () => {
    expect(changedPackagesOf(packageScoped, undefined)).toEqual(new Set(['packages/ui']))
  })

  it("counts an asset's package when the graph doesn't hold it", () => {
    expect(changedPackagesOf(packageScoped, new Set(['packages/ui/package.json']))).toEqual(
      new Set(['packages/ui', 'packages/icons']),
    )
  })

  it("leaves out an asset's package when the graph holds it, but never a package config's", () => {
    expect(changedPackagesOf(packageScoped, new Set(['packages/ui/package.json', 'packages/icons/star.svg']))).toEqual(
      new Set(['packages/ui']),
    )
  })
})
