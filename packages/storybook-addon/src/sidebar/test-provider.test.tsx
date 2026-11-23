import React, { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { API } from 'storybook/manager-api'
import { convert, ThemeProvider, themes } from 'storybook/theming'
import { describe, expect, it, vi } from 'vitest'
import type { VisualCheckState } from '../channel-events/events.js'
import { runWith } from '../channel-events/state.fixture.js'
import { checkFromMenu } from './check-menu-item.js'
import { testProviderOf } from './test-provider.js'

/**
 * Builds the API and a manager's state, whose calls go in one list, in order.
 */
function build(current: VisualCheckState = { run: null, results: {} }) {
  const calls: unknown[][] = []

  return {
    calls,
    api: {
      selectStory: (...values: unknown[]) => calls.push(['selectStory', ...values]),
      setSelectedPanel: (...values: unknown[]) => calls.push(['setSelectedPanel', ...values]),
      togglePanel: (...values: unknown[]) => calls.push(['togglePanel', ...values]),
    },
    state: {
      subscribe: () => () => undefined,
      getState: () => current,
      check: (...values: unknown[]) => calls.push(['check', ...values]),
      update: (...values: unknown[]) => calls.push(['update', ...values]),
      cancel: vi.fn(),
      clear: vi.fn(),
    },
  }
}

/**
 * Gives what the test provider adds to the menu of an entry.
 */
function menuOf(type: string, current?: VisualCheckState): ReactNode {
  const { api, state } = build(current)
  const context = { type, id: 'card--default' } as ReturnType<API['getCurrentStoryData']>

  return testProviderOf(api, state).sidebarContextMenu?.({ context })
}

/**
 * Renders in Storybook's light theme.
 */
function render(node: ReactNode): string {
  return renderToStaticMarkup(<ThemeProvider theme={convert(themes.light)}>{node}</ThemeProvider>)
}

describe('testProviderOf', () => {
  it('adds an item to the menu of a story', () => {
    expect(render(menuOf('story'))).toContain(
      '<button type="button" data-visual-check="menu-check" aria-disabled="false">Check with visual-check</button>',
    )
  })

  it('disables it while a run is in flight, whichever story it checks', () => {
    const run = runWith({ storyId: 'button--primary' })

    expect(render(menuOf('story', { run, results: {} }))).toContain(
      'data-visual-check="menu-check" aria-disabled="true"',
    )
  })

  it.each(['docs', 'component', 'group', 'root'])('adds nothing to the menu of a %s', (type) => {
    expect(menuOf(type)).toBeNull()
  })

  it('says how to check', () => {
    const { api, state } = build()
    const { render: Line } = testProviderOf(api, state)

    expect(render(<Line />)).toContain('Check one story at a time, from its Visual check panel or its menu.')
  })

  it('clears the results with the statuses', () => {
    const { api, state } = build()

    testProviderOf(api, state).clear?.()

    expect(state.clear).toHaveBeenCalledTimes(1)
  })
})

describe('checkFromMenu', () => {
  it('selects the story, shows the panel and asks for a check', () => {
    const { api, state, calls } = build()

    checkFromMenu({ storyId: 'card--default', api, state })

    expect(calls).toEqual([
      ['selectStory', 'card--default'],
      ['setSelectedPanel', 'visual-check/panel'],
      ['togglePanel', true],
      ['check', 'card--default'],
    ])
  })

  it('does nothing while a run is in flight', () => {
    const { api, state, calls } = build({ run: runWith(), results: {} })

    checkFromMenu({ storyId: 'card--default', api, state })

    expect(calls).toEqual([])
  })
})
