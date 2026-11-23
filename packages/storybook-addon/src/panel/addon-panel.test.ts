import type { LeafEntry } from 'storybook/manager-api'
import { describe, expect, it, vi } from 'vitest'
import { storyOf } from './addon-panel.js'

// It needs `document` at import.
vi.mock('storybook/internal/components', () => ({ AddonPanel: () => null }))

/**
 * Builds an entry of Storybook's index, a story, with the fields given.
 */
function entryWith(fields: Record<string, unknown> = {}): LeafEntry {
  return { type: 'story', id: 'forms-card--default', title: 'Forms/Card', name: 'Default', ...fields } as LeafEntry
}

describe('storyOf', () => {
  it("gives a story's ID, and its title and name", () => {
    expect(storyOf(entryWith())).toEqual({ id: 'forms-card--default', name: 'Forms/Card / Default' })
  })

  it('gives none for a docs page, a story of a composed Storybook, and before there is an entry', () => {
    expect(storyOf(entryWith({ type: 'docs' }))).toBeNull()
    expect(storyOf(entryWith({ refId: 'other' }))).toBeNull()
    expect(storyOf(undefined)).toBeNull()
  })
})
