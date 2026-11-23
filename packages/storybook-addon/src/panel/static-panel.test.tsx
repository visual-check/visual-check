import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { convert, ThemeProvider, themes } from 'storybook/theming'
import { describe, expect, it, vi } from 'vitest'
import type { PanelStory } from './panel-view.js'
import { copiedLabelOf, StaticPanelView } from './static-panel.js'

// It needs `document` at import.
vi.mock('storybook/internal/components', () => ({ AddonPanel: () => null }))

const story: PanelStory = { id: 'components-button--primary', name: 'Components / Button / Primary' }

/**
 * Renders the static panel and leaves its CSS out.
 */
function render(current: PanelStory | null, storybook = 'web'): string {
  const markup = renderToStaticMarkup(
    <ThemeProvider theme={convert(themes.light)}>
      <StaticPanelView story={current} storybook={storybook} address="http://127.0.0.1:6006" />
    </ThemeProvider>,
  )

  return markup.replace(/<style>.*?<\/style>/s, '')
}

/**
 * Gives the text of each part with the name.
 */
function textsOf(markup: string, name: string): string[] {
  const pattern = new RegExp(`<(\\w+)[^>]*data-visual-check="${name}"[^>]*>(.*?)</\\1>`, 'gs')

  return [...markup.matchAll(pattern)].map(([, , text]) => (text ?? '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'"))
}

describe('StaticPanelView', () => {
  it("shows the story's test and update commands, each with a copy button", () => {
    const markup = render(story)

    expect(textsOf(markup, 'static-command')).toEqual([
      "visual-check test --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006",
      "visual-check update --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006",
    ])
    expect(textsOf(markup, 'copy')).toEqual(['Copy', 'Copy'])
    expect(textsOf(markup, 'static-note')).toEqual([
      "That update also writes this Storybook's other missing baselines and deletes its orphans, as every update does.",
    ])
  })

  it('says to run init when the build has no name for the Storybook', () => {
    const markup = render(story, '')

    expect(textsOf(markup, 'static-no-name')).toEqual([
      'visual-check found no entry for this Storybook in its config when this build was made. ' +
        'Run visual-check init, then build it again.',
    ])
    expect(textsOf(markup, 'static-command')).toEqual([])
  })

  it('asks for a story when there is none', () => {
    const markup = render(null)

    expect(textsOf(markup, 'empty')).toEqual(['Select a story to see its commands.'])
    expect(textsOf(markup, 'static-command')).toEqual([])
  })
})

describe('copiedLabelOf', () => {
  it('writes the command to the clipboard, and says it is copied', async () => {
    const writeText = vi.fn(async () => undefined)

    expect(await copiedLabelOf('visual-check test', { writeText })).toBe('Copied')
    expect(writeText).toHaveBeenCalledWith('visual-check test')
  })

  it("says the copy failed when the clipboard won't take it", async () => {
    const writeText = vi.fn(async () => {
      throw new Error('Write permission denied.')
    })

    expect(await copiedLabelOf('visual-check test', { writeText })).toBe('Copy failed')
  })
})
