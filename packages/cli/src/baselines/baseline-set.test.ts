import { describe, expect, it } from 'vitest'
import { baselineFileNameOf } from './baseline-files.js'
import { baselineCountsOf, orphansOf } from './baseline-set.js'

/**
 * `é` as one code point, as NFC encodes it.
 */
const composedE = 'é'.normalize('NFC')

/**
 * `é` as `e` and a combining acute accent, as NFD encodes it.
 */
const decomposedE = composedE.normalize('NFD')

describe('orphansOf', () => {
  it('finds a baseline no expected key names', () => {
    expect(
      orphansOf({
        fileNames: ['a.png', 'gone.png', 'b.dark.png'],
        expectedKeys: ['a', 'b.dark'],
        unloadedStoryIds: [],
      }),
    ).toEqual(['gone.png'])
  })

  it("keeps every expected key's baseline, a mode's and a shortened one's included", () => {
    const longKey = `story--${'x'.repeat(300)}`
    const fileNames = ['a.png', 'a.dark.png', baselineFileNameOf(longKey)]

    expect(orphansOf({ fileNames, expectedKeys: ['a', 'a.dark', longKey], unloadedStoryIds: [] })).toEqual([])
  })

  it('gives a baseline whose name differs from an expected one only in case or in accent encoding as an orphan', () => {
    const fileNames = [`caf${decomposedE}--primary.png`, 'Button--Primary.png', 'button--primary.png']
    const expectedKeys = [`caf${composedE}--primary`, 'button--primary']

    expect(orphansOf({ fileNames, expectedKeys, unloadedStoryIds: [] })).toEqual([
      `caf${decomposedE}--primary.png`,
      'Button--Primary.png',
    ])
  })

  it('gives the orphans in the order given', () => {
    expect(orphansOf({ fileNames: ['c.png', 'a.png', 'b.png'], expectedKeys: [], unloadedStoryIds: [] })).toEqual([
      'c.png',
      'a.png',
      'b.png',
    ])
  })

  it("keeps the default capture's, the modes' and the shortened baselines of a story whose file didn't load", () => {
    const longMode = `button.${'m'.repeat(300)}`
    const fileNames = ['button.png', 'button.dark.png', 'Button.Wide.png', baselineFileNameOf(longMode)]

    expect(orphansOf({ fileNames, expectedKeys: [], unloadedStoryIds: ['button'] })).toEqual([])
  })

  it("keeps a baseline of a story whose file didn't load that differs from its keys only in case or accent encoding", () => {
    const fileNames = [`Caf${decomposedE}.png`, `caf${decomposedE}.Dark.png`]

    expect(orphansOf({ fileNames, expectedKeys: [], unloadedStoryIds: [`caf${composedE}`] })).toEqual([])
  })

  it("keeps the shortened baselines of a long story ID whose file didn't load", () => {
    const longId = `button--${'s'.repeat(300)}`
    const fileNames = [baselineFileNameOf(longId), baselineFileNameOf(`${longId}.dark`)]

    expect(orphansOf({ fileNames, expectedKeys: [], unloadedStoryIds: [longId] })).toEqual([])
  })

  it("keeps a shortened baseline whose kept start ends inside the mode start of a story whose file didn't load", () => {
    const storyId = 's'.repeat(223)
    const fileName = baselineFileNameOf(`${storyId}.${'m'.repeat(30)}`)

    expect(fileName).toMatch(/^s{223}-[0-9a-f]{16}\.png$/)
    expect(orphansOf({ fileNames: [fileName], expectedKeys: [], unloadedStoryIds: [storyId] })).toEqual([])
  })

  it("gives a neighbour that only starts with the ID of a story whose file didn't load as an orphan", () => {
    const longOther = `button-group.${'m'.repeat(300)}`
    const fileNames = ['button-group.png', 'buttons.png', baselineFileNameOf(longOther), 'button.png']

    expect(orphansOf({ fileNames, expectedKeys: [], unloadedStoryIds: ['button'] })).toEqual([
      'button-group.png',
      'buttons.png',
      baselineFileNameOf(longOther),
    ])
  })

  it("gives a shortened key's shape with a short start as an orphan beside a story whose file didn't load", () => {
    const fileNames = ['button-0123456789abcdef.png', 'b-0123456789abcdef.png']

    expect(orphansOf({ fileNames, expectedKeys: [], unloadedStoryIds: ['button'] })).toEqual(fileNames)
  })
})

describe('baselineCountsOf', () => {
  it("counts a story's default capture and its modes", () => {
    const fileNames = ['button.png', 'button.dark.png', 'button.wide.png', 'card.png']

    expect(baselineCountsOf(fileNames, ['button', 'card'])).toEqual(
      new Map([
        ['button', 3],
        ['card', 1],
      ]),
    )
  })

  it('gives a story with no baselines a count of 0', () => {
    expect(baselineCountsOf(['card.png'], ['button', 'card'])).toEqual(
      new Map([
        ['button', 0],
        ['card', 1],
      ]),
    )
  })

  it("doesn't count a neighbour that only starts with the story ID", () => {
    const fileNames = ['button.png', 'button-group.png', 'button-group.dark.png', 'buttons.png']

    expect(baselineCountsOf(fileNames, ['button', 'button-group'])).toEqual(
      new Map([
        ['button', 1],
        ['button-group', 2],
      ]),
    )
  })

  it('counts the shortened baselines of a long story ID and of a long mode', () => {
    const longId = `button--${'s'.repeat(300)}`
    const fileNames = [
      baselineFileNameOf(longId),
      baselineFileNameOf(`${longId}.dark`),
      baselineFileNameOf(`button.${'m'.repeat(300)}`),
    ]

    expect(baselineCountsOf(fileNames, [longId, 'button'])).toEqual(
      new Map([
        [longId, 2],
        ['button', 1],
      ]),
    )
  })

  it('counts a shortened baseline whose kept start ends inside the mode start', () => {
    const storyId = 's'.repeat(223)
    const fileName = baselineFileNameOf(`${storyId}.${'m'.repeat(30)}`)

    expect(baselineCountsOf([fileName], [storyId])).toEqual(new Map([[storyId, 1]]))
  })

  it("doesn't count a shortened key's shape with a short start", () => {
    expect(baselineCountsOf(['button-0123456789abcdef.png'], ['button'])).toEqual(new Map([['button', 0]]))
  })

  it('counts a baseline that differs from the keys only in case or in accent encoding', () => {
    const fileNames = [`Caf${decomposedE}.png`, `caf${decomposedE}.Dark.png`, 'BUTTON.png']

    expect(baselineCountsOf(fileNames, [`caf${composedE}`, 'button'])).toEqual(
      new Map([
        [`caf${composedE}`, 2],
        ['button', 1],
      ]),
    )
  })

  it("doesn't count an orphan for any story", () => {
    expect(baselineCountsOf(['gone.png', 'gone.dark.png'], ['button'])).toEqual(new Map([['button', 0]]))
  })
})
