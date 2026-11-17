import { describe, expect, it } from 'vitest'
import type { Story } from '../storybook/read-stories.js'
import { selectStories } from './select-stories.js'

/**
 * Builds a story with the given ID in the given stories file.
 */
function storyOf(id: string, importPath: string): Story {
  return { id, title: 'Title', name: 'Name', importPath }
}

/**
 * Three stories of two components, each in its own stories file.
 */
const stories = [
  storyOf('button--primary', './src/button.stories.tsx'),
  storyOf('button--secondary', './src/button.stories.tsx'),
  storyOf('card--primary', './src/card.stories.tsx'),
]

describe('selectStories', () => {
  it('keeps every story for all', () => {
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

  it('keeps the stories of the given stories files, in their order', () => {
    expect(
      selectStories(stories, {
        kind: 'stories-files',
        storiesFiles: new Set(['./src/card.stories.tsx', './src/button.stories.tsx']),
      }).map((story) => story.id),
    ).toEqual(['button--primary', 'button--secondary', 'card--primary'])
    expect(
      selectStories(stories, { kind: 'stories-files', storiesFiles: new Set(['./src/card.stories.tsx']) }).map(
        (story) => story.id,
      ),
    ).toEqual(['card--primary'])
  })

  it('keeps nothing when no stories file is given', () => {
    expect(selectStories(stories, { kind: 'stories-files', storiesFiles: new Set() })).toEqual([])
  })
})
