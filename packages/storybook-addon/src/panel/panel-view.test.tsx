import type { AddonSnapshot } from '@visual-check/cli/internal/addon-protocol'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { convert, ThemeProvider, themes } from 'storybook/theming'
import { describe, expect, it } from 'vitest'
import type { StoryOutcome, StoryResult, VisualCheckState } from '../channel-events/events.js'
import { checkedWith, runWith, snapshotWith, stateWith, stoppedWith } from '../channel-events/state.fixture.js'
import { type PanelStory, PanelView } from './panel-view.js'

const story: PanelStory = { id: 'card--default', name: 'Card / Default' }

const passed = snapshotWith()
const differs = snapshotWith({
  id: 'card--default.dark',
  mode: 'dark',
  status: 'differs',
  reason: 'pixels',
  message: '84 differ, 80 allowed',
  images: {
    baseline: 'snapshots/web/a.dark.baseline.png',
    snapshot: 'snapshots/web/a.dark.snapshot.png',
    diff: 'diffs/web/a.dark.png',
  },
})
const missing = snapshotWith({
  id: 'card--default.mobile',
  mode: 'mobile',
  status: 'missing',
  message: 'No baseline yet.',
  images: { baseline: null, snapshot: 'snapshots/web/a.mobile.snapshot.png', diff: null },
})

/**
 * Renders the panel and leaves its CSS out.
 */
function render(state: VisualCheckState, current: PanelStory | null = story): string {
  const markup = renderToStaticMarkup(
    <ThemeProvider theme={convert(themes.light)}>
      <PanelView story={current} state={state} actions={{ check: () => undefined, cancel: () => undefined }} />
    </ThemeProvider>,
  )

  return markup.replace(/<style>.*?<\/style>/s, '')
}

/**
 * Renders the panel of a check that finished with the snapshots.
 */
function renderChecked(snapshots: AddonSnapshot[], fields: Partial<StoryResult> = {}): string {
  return render(stateWith(checkedWith(snapshots), fields))
}

/**
 * Gives the opening tag and the text of each part with the name.
 */
function partsOf(markup: string, name: string): { tag: string; text: string }[] {
  const pattern = new RegExp(`(<(\\w+)[^>]* data-visual-check="${name}"[^>]*>)(.*?)</\\2>`, 'gs')

  return [...markup.matchAll(pattern)].map(([, tag = '', , inner = '']) => ({
    tag,
    text: inner.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'"),
  }))
}

/**
 * Gives the text of each part with the name.
 */
function textsOf(markup: string, name: string): string[] {
  return partsOf(markup, name).map(({ text }) => text)
}

/**
 * Gives the opening tag of the only part with the name.
 */
function tagOf(markup: string, name: string): string | undefined {
  const parts = partsOf(markup, name)

  return parts.length === 1 ? parts[0]?.tag : undefined
}

describe('PanelView', () => {
  it('lists three rows and shows the image of the first that is not passed', () => {
    const markup = renderChecked([passed, missing, differs])

    expect(textsOf(markup, 'label')).toEqual(['Default', 'mobile', 'dark'])
    expect(textsOf(markup, 'status')).toEqual(['Passed', 'Missing baseline', 'Visual diff'])
    expect(textsOf(markup, 'message')).toEqual(['No baseline yet.', '84 differ, 80 allowed'])
    expect(textsOf(markup, 'reason')).toEqual(['Reason: pixels'])
    expect(textsOf(markup, 'row')).toHaveLength(3)
    expect(partsOf(markup, 'row').map(({ tag }) => /aria-pressed="(\w+)"/.exec(tag)?.[1])).toEqual([
      'false',
      'true',
      'false',
    ])
    expect(markup).toContain('<ul data-visual-check="rows">')
    expect(markup.match(/<img[^>]*>/g)).toEqual([
      '<img data-visual-check="image-snapshot" src="__visual-check/images/click-1/snapshots/web/a.mobile.snapshot.png"' +
        ' alt="Card / Default, mobile: snapshot"/>',
    ])
    expect(tagOf(markup, 'check')).toContain('aria-disabled="false"')
    expect(partsOf(markup, 'cancel')).toEqual([])
    expect(textsOf(markup, 'run')).toEqual(['1 visual diff, 1 missing baseline'])
  })

  it('shows the images of a visual diff under the slider', () => {
    const markup = renderChecked([passed, differs])

    expect(markup).toContain('src="__visual-check/images/click-1/snapshots/web/a.dark.baseline.png"')
    expect(markup).toContain('src="__visual-check/images/click-1/snapshots/web/a.dark.snapshot.png"')
    expect(markup).toContain('data-visual-check="slider"')
  })

  it('selects the first row when every one passed, with no image when it has none', () => {
    const markup = renderChecked([passed, { ...passed, id: 'card--default.dark', mode: 'dark' }])

    expect(partsOf(markup, 'row').map(({ tag }) => tag.includes('aria-pressed="true"'))).toEqual([true, false])
    expect(markup).not.toContain('<img')
    expect(partsOf(markup, 'message')).toEqual([])
  })

  it('marks a flaky snapshot and says why', () => {
    const markup = renderChecked([snapshotWith({ flaky: true, message: 'Passed on retry 1.' }), missing])

    expect(textsOf(markup, 'flaky')).toEqual(['Flaky'])
    expect(textsOf(markup, 'status')[0]).toBe('Passed')
    expect(textsOf(markup, 'message')[0]).toBe('Passed on retry 1.')
  })

  it('shows the hints', () => {
    const hints: AddonSnapshot['hints'] = [{ kind: 'remote-content', hosts: ['a.test'], message: 'Mask a.test.' }]

    expect(textsOf(renderChecked([{ ...differs, hints }]), 'hint')).toEqual(['Hint: Mask a.test.'])
  })

  it("shows a broken story's message, reason, details and its page", () => {
    const markup = renderChecked([
      snapshotWith({
        status: 'broken',
        reason: 'play-threw',
        message: "The story's play function threw.",
        details: { play: { message: 'Error: Boom', stack: ['at play (a.ts:1:1)'] } },
        images: { baseline: null, snapshot: 'snapshots/web/a.snapshot.png', diff: null },
      }),
    ])

    expect(textsOf(markup, 'status')).toEqual(['Broken story'])
    expect(textsOf(markup, 'message')).toEqual(["The story's play function threw."])
    expect(textsOf(markup, 'reason')).toEqual(['Reason: play-threw'])
    expect(textsOf(markup, 'details')).toEqual(['Error: Boom\nat play (a.ts:1:1)'])
    expect(markup).toContain('alt="Card / Default, Default: snapshot"')
  })

  it('shows a run of the story, its earlier result dimmed', () => {
    const run = runWith({ step: 'capturing', finished: 1, total: 3 })
    const markup = render({ ...stateWith(checkedWith([passed])), run })

    expect(tagOf(markup, 'run')).toContain('role="status"')
    expect(textsOf(markup, 'run')).toEqual(['Capturing 2 of 3…'])
    expect(tagOf(markup, 'check')).toContain('aria-disabled="true"')
    expect(tagOf(markup, 'cancel')).toContain('aria-disabled="false"')
    expect(markup).toContain('<div data-visual-check="results" data-dimmed="true">')
    expect(partsOf(markup, 'stale')).toEqual([])
    expect(partsOf(markup, 'log')).toEqual([])
  })

  it('shows a first run with nothing below', () => {
    const markup = render({ run: runWith(), results: {} })

    expect(textsOf(markup, 'run')).toEqual(['Starting…'])
    expect(partsOf(markup, 'empty')).toEqual([])
  })

  it("shows the log of the browser's pull", () => {
    const markup = render({ run: runWith({ step: 'browser', log: ['Pulling', 'Waiting', ''] }), results: {} })

    expect(textsOf(markup, 'run')).toEqual(['Getting the browser…'])
    expect(partsOf(markup, 'log')).toEqual([{ tag: '<pre data-visual-check="log">', text: 'Pulling\nWaiting' }])
  })

  it('shows a run that is being cancelled', () => {
    const markup = render({ run: runWith({ cancelling: true }), results: {} })

    expect(textsOf(markup, 'run')).toEqual(['Cancelling…'])
    expect(tagOf(markup, 'cancel')).toContain('aria-disabled="true"')
  })

  it("shows another story's run beside the story's own result", () => {
    const run = runWith({ storyId: 'button--primary' })
    const markup = render({ ...stateWith(checkedWith([passed])), run })

    expect(textsOf(markup, 'run')).toEqual(['Another story is being checked: button--primary. Starting…'])
    expect(tagOf(markup, 'check')).toContain('aria-disabled="true"')
    expect(tagOf(markup, 'cancel')).toContain('aria-disabled="false"')
    expect(markup).toContain('<div data-visual-check="results">')
  })

  it('shows what stopped the check, verbatim', () => {
    const message = "visual-check can't reach Docker.\n  - Start it.\nOr set platform: 'host'."
    const markup = render(stateWith(stoppedWith({ message, notices: ['A notice.'] })))

    expect(partsOf(markup, 'error')).toEqual([{ tag: '<p role="alert" data-visual-check="error">', text: message }])
    expect(textsOf(markup, 'notice')).toEqual(['A notice.'])
    expect(partsOf(markup, 'init-hint')).toEqual([])
  })

  it('names init when the config stopped the check', () => {
    const markup = render(stateWith(stoppedWith({ cause: 'config', message: 'No config.' })))

    expect(textsOf(markup, 'error')).toEqual(['No config.'])
    expect(textsOf(markup, 'init-hint')).toEqual(['Run visual-check init to set this Storybook up.'])
  })

  it('shows a stale result dimmed, below what makes it stale', () => {
    const markup = renderChecked([differs], { stale: true })

    expect(textsOf(markup, 'run')).toEqual(['Stale: 1 visual diff'])
    expect(textsOf(markup, 'stale')).toEqual(['Stale: something changed since this check. Check again.'])
    expect(markup).toContain('<div data-visual-check="results" data-dimmed="true">')
    expect(textsOf(markup, 'status')).toEqual(['Visual diff'])
  })

  it.each<[part: string, outcome: StoryOutcome]>([
    ['error', stoppedWith({ notices: ['A notice.'] })],
    ['init-hint', stoppedWith({ cause: 'config', notices: ['A notice.'] })],
    ['disabled', checkedWith([], { disabled: true, notices: ['A notice.'] })],
    ['rows', checkedWith([differs], { notices: ['A notice.'] })],
  ])('dims the notices and the %s of an earlier result, not what makes it stale', (part, outcome) => {
    const dimmed = '<div data-visual-check="results" data-dimmed="true">'
    const stale = render(stateWith(outcome, { stale: true }))
    const running = render({ ...stateWith(outcome), run: runWith() })

    for (const markup of [stale, running]) {
      const [, inside = ''] = markup.split(dimmed)

      expect(inside).toContain('data-visual-check="notice"')
      expect(inside).toContain(`data-visual-check="${part}"`)
    }

    expect(stale.split(dimmed)[0]).toContain('data-visual-check="stale"')
    expect(render(stateWith(outcome))).not.toContain('data-dimmed')
  })

  it('says a story is disabled', () => {
    const markup = render(stateWith(checkedWith([], { disabled: true, notices: ['A notice.'] })))

    expect(textsOf(markup, 'disabled')).toEqual([
      "parameters.visualCheck disables this story, so visual-check doesn't capture it.",
    ])
    expect(textsOf(markup, 'notice')).toEqual(['A notice.'])
    expect(markup).not.toContain('<ul')
  })

  it('shows every notice, its lines and no twin', () => {
    const markup = render(stateWith(checkedWith([passed], { notices: ['One.\n  - More.', 'Two.', 'Two.'] })))

    expect(textsOf(markup, 'notice')).toEqual(['One.\n  - More.', 'Two.'])
    expect(textsOf(markup, 'row')).toHaveLength(1)
  })

  it('says a story is not checked yet', () => {
    const markup = render({ run: null, results: {} })

    expect(textsOf(markup, 'empty')).toEqual(["This story isn't checked yet."])
    expect(tagOf(markup, 'check')).toContain('aria-disabled="false"')
  })

  it('takes no property every object has for a result', () => {
    const markup = render({ run: null, results: {} }, { id: 'constructor', name: 'Constructor' })

    expect(textsOf(markup, 'empty')).toEqual(["This story isn't checked yet."])
  })

  it('asks for a story without one, and still shows the run', () => {
    const markup = render({ ...stateWith(checkedWith([passed])), run: runWith() }, null)

    expect(textsOf(markup, 'empty')).toEqual(['Select a story to check it.'])
    expect(textsOf(markup, 'run')).toEqual(['Another story is being checked: card--default. Starting…'])
    expect(tagOf(markup, 'check')).toContain('aria-disabled="true"')
    expect(tagOf(render({ run: null, results: {} }, null), 'check')).toContain('aria-disabled="true"')
  })
})
