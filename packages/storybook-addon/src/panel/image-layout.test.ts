import { describe, expect, it } from 'vitest'
import { layoutOf, type Size } from './image-layout.js'

describe('layoutOf', () => {
  it.each<[name: string, baseline: Size, snapshot: Size, layout: ReturnType<typeof layoutOf>]>([
    [
      'two of one size',
      { width: 400, height: 300 },
      { width: 400, height: 300 },
      { width: '400px', aspectRatio: '400 / 300', baselineWidth: '100%', snapshotWidth: '100%' },
    ],
    [
      'a taller snapshot',
      { width: 400, height: 300 },
      { width: 400, height: 500 },
      { width: '400px', aspectRatio: '400 / 500', baselineWidth: '100%', snapshotWidth: '100%' },
    ],
    [
      'a wider snapshot',
      { width: 300, height: 300 },
      { width: 400, height: 300 },
      { width: '400px', aspectRatio: '400 / 300', baselineWidth: '75%', snapshotWidth: '100%' },
    ],
    [
      'a wider baseline and a taller snapshot',
      { width: 400, height: 100 },
      { width: 100, height: 300 },
      { width: '400px', aspectRatio: '400 / 300', baselineWidth: '100%', snapshotWidth: '25%' },
    ],
    [
      'a snapshot at scale 2 of a baseline at scale 1',
      { width: 375, height: 667 },
      { width: 750, height: 1334 },
      { width: '750px', aspectRatio: '750 / 1334', baselineWidth: '50%', snapshotWidth: '100%' },
    ],
  ])('lays out %s', (_name, baseline, snapshot, layout) => {
    expect(layoutOf(baseline, snapshot)).toEqual(layout)
  })
})
