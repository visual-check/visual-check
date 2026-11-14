import { describe, expect, it } from 'vitest'
import type { Story } from '../storybook/read-stories.js'
import { selectStories } from './select-stories.js'

/**
 * Builds a story with the given ID.
 */
function storyOf(id: string): Story {
  return { id, title: 'Title', name: 'Name', importPath: './src/a.stories.tsx' }
}

/**
 * Three stories of two components.
 */
const stories = [storyOf('button--primary'), storyOf('button--secondary'), storyOf('card--primary')]

describe('selectStories', () => {
  it('keeps every story by default', () => {
    expect(selectStories(stories, { kind: 'default' })).toEqual(stories)
  })

  it('keeps every story for --all', () => {
    expect(selectStories(stories, { kind: 'all' })).toEqual(stories)
  })

  it('keeps the stories whose ID matches an unanchored pattern', () => {
    expect(selectStories(stories, { kind: 'filter', pattern: /primary/ }).map((story) => story.id)).toEqual([
      'button--primary',
      'card--primary',
    ])
  })

  it('keeps the stories whose ID matches an anchored pattern', () => {
    expect(selectStories(stories, { kind: 'filter', pattern: /^button--/ }).map((story) => story.id)).toEqual([
      'button--primary',
      'button--secondary',
    ])
  })

  it('keeps nothing when no ID matches', () => {
    expect(selectStories(stories, { kind: 'filter', pattern: /^nope$/ })).toEqual([])
  })
})
