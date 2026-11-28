import type { StoryContext } from 'storybook/internal/types'
import { combineParameters } from 'storybook/preview-api'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineVisualCheck } from './define-visual-check.js'

/**
 * The modes the tests declare.
 */
const modes = {
  narrow: { viewport: { width: 375, height: 667 } },
  wide: { viewport: { width: 1600 } },
  dark: { globals: { theme: 'dark' } },
}

/**
 * The helper under test, declared with `modes`.
 */
const visualCheck = defineVisualCheck({ modes })

describe('defineVisualCheck', () => {
  it('copies every key it is given under visualCheck', () => {
    const wait = () => undefined
    const result = visualCheck({
      defaultCapture: false,
      viewport: { width: 800 },
      element: '#root',
      growViewport: false,
      allowOverflow: true,
      masks: { clock: { selector: '.clock' }, ad: { host: 'ads.example.com' }, gone: null },
      tolerance: { color: 0.1, pixels: '1%' },
      disable: true,
      pageErrors: 'warn',
      expectedPageErrors: ['Failed to fetch', /\/api\/orders/],
      realRequests: 'fail',
      wait,
    })

    expect(result).toEqual({
      visualCheck: {
        defaultCapture: false,
        viewport: { width: 800 },
        element: '#root',
        growViewport: false,
        allowOverflow: true,
        masks: {
          clock: { selector: '.clock', host: null },
          ad: { host: 'ads.example.com', selector: null },
          gone: null,
        },
        tolerance: { color: 0.1, pixels: '1%' },
        disable: true,
        pageErrors: 'warn',
        expectedPageErrors: ['Failed to fetch', /\/api\/orders/],
        realRequests: 'fail',
        wait,
      },
    })
  })

  it('leaves out a key set to undefined', () => {
    const result = visualCheck({ viewport: undefined, element: undefined, masks: undefined, disable: false })

    expect(Object.keys(result.visualCheck)).toEqual(['disable'])
  })

  it('keeps null, which turns an inherited value off', () => {
    const result = visualCheck({ element: null, masks: null, wait: null })

    expect(result.visualCheck).toEqual({ element: null, masks: null, wait: null })
  })

  it('writes every declared mode in the key order of the declaration, null for the unlisted ones', () => {
    const result = visualCheck({ modes: ['dark', 'narrow'] })

    expect(Object.keys(result.visualCheck.modes ?? {})).toEqual(['narrow', 'wide', 'dark'])
    expect(result.visualCheck.modes).toEqual({ narrow: modes.narrow, wide: null, dark: modes.dark })
  })

  it('writes every declared mode as null for an empty list', () => {
    expect(visualCheck({ modes: [] }).visualCheck.modes).toEqual({ narrow: null, wide: null, dark: null })
  })

  it('writes no modes key when modes is absent or undefined', () => {
    expect('modes' in visualCheck({}).visualCheck).toBe(false)
    expect('modes' in visualCheck({ modes: undefined }).visualCheck).toBe(false)
  })

  it('ignores a mode name the declaration lacks at run time', () => {
    // @ts-expect-error 'tablet' is not a declared mode.
    const result = visualCheck({ modes: ['tablet', 'wide'] })

    expect(result.visualCheck.modes).toEqual({ narrow: null, wide: modes.wide, dark: null })
  })

  it('passes bad plain-JS masks through with their keys, for the CLI to reject', () => {
    const masks = { a: { selector: '.a', host: 'x' }, b: { selector: '.b', typo: 1 } } as never
    const result = visualCheck({ masks })

    expect(result.visualCheck.masks).toEqual({
      a: { selector: '.a', host: 'x' },
      b: { selector: '.b', host: null, typo: 1 },
    })
  })

  it('returns a fresh object each call', () => {
    const first = visualCheck({ modes: ['dark'], viewport: { width: 1 } })
    const second = visualCheck({ modes: ['dark'], viewport: { width: 1 } })

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.visualCheck).not.toBe(second.visualCheck)
    expect(first.visualCheck.modes).not.toBe(second.visualCheck.modes)
  })

  it('types wait with a StoryContext and rejects undeclared modes', () => {
    visualCheck({
      wait: (context) => {
        expectTypeOf(context).toEqualTypeOf<StoryContext>()
      },
    })
    // @ts-expect-error 'tablet' is not a declared mode.
    visualCheck({ modes: ['tablet'] })
    // @ts-expect-error A mask is a selector or a host, not both.
    visualCheck({ masks: { ad: { selector: '.a', host: 'x' } } })
    // @ts-expect-error The hook gets a StoryContext, not a number.
    visualCheck({ wait: (context: number) => void context })
  })

  it('types pageErrors and expectedPageErrors', () => {
    visualCheck({ pageErrors: 'off', expectedPageErrors: ['Failed to fetch', /timeout/] as const })
    // @ts-expect-error pageErrors is 'fail', 'warn' or 'off'.
    visualCheck({ pageErrors: 'error' })
    // @ts-expect-error An expected page error is a string or a regular expression.
    visualCheck({ expectedPageErrors: [404] })
    // @ts-expect-error expectedPageErrors is a list.
    visualCheck({ expectedPageErrors: 'Failed to fetch' })
  })

  it('types realRequests', () => {
    visualCheck({ realRequests: 'warn' })
    // @ts-expect-error realRequests is 'fail', 'warn' or 'off'.
    visualCheck({ realRequests: true })
  })
})

describe('defineVisualCheck with a globals generic', () => {
  type Globals = { theme: 'light' | 'dark'; density: 'compact' | 'comfortable' }

  interface InterfaceGlobals {
    theme: 'light' | 'dark'
  }

  const declaration = {
    modes: {
      dark: { globals: { theme: 'dark' } },
      mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
    },
  } as const

  it('writes what the one-argument form writes', () => {
    const typed = defineVisualCheck<Globals>()(declaration)
    const untyped = defineVisualCheck(declaration)
    const options = { modes: ['dark'] as const, viewport: { width: 800 }, masks: { ad: { host: 'ads.example.com' } } }

    expect(typed(options)).toEqual(untyped(options))
    expect(typed({ modes: ['dark'] }).visualCheck.modes).toEqual({ dark: declaration.modes.dark, mobile: null })
  })

  it('types globals by the generic', () => {
    defineVisualCheck<Globals>()({ modes: { dark: { globals: { theme: 'dark' } } } })
    defineVisualCheck<Globals>()({ modes: { dense: { globals: { density: 'compact', theme: 'light' } } } })
    defineVisualCheck<InterfaceGlobals>()({ modes: { dark: { globals: { theme: 'dark' } } } })
    // @ts-expect-error 'blue' is not a value of theme.
    defineVisualCheck<Globals>()({ modes: { blue: { globals: { theme: 'blue' } } } })
    // @ts-expect-error 'contrast' is not a declared global.
    defineVisualCheck<Globals>()({ modes: { contrast: { globals: { contrast: 'high' } } } })
    // @ts-expect-error 'blue' is not a value of theme, for an interface too.
    defineVisualCheck<InterfaceGlobals>()({ modes: { blue: { globals: { theme: 'blue' } } } })
  })

  it('rejects a generic that is not an object of globals', () => {
    // @ts-expect-error A string is not a set of globals.
    defineVisualCheck<string>()
  })

  it('still checks mode names against the declaration', () => {
    const visualCheck = defineVisualCheck<Globals>()({ modes: { dark: { globals: { theme: 'dark' } } } })

    visualCheck({ modes: ['dark'] })
    // @ts-expect-error 'tablet' is not a declared mode.
    visualCheck({ modes: ['tablet'] })
  })

  it('keeps any GlobalValue in the one-argument form', () => {
    defineVisualCheck({ modes: { any: { globals: { theme: 'blue', count: 2, flag: true } } } })
    // @ts-expect-error A global can't be undefined.
    defineVisualCheck({ modes: { unset: { globals: { theme: undefined } } } })
    // @ts-expect-error A global is a string, a number or a boolean.
    defineVisualCheck({ modes: { bad: { globals: { theme: { nested: 1 } } } } })
  })
})

describe('merging through Storybook', () => {
  /**
   * Merges the levels as Storybook does, least specific first, and returns the merged `visualCheck`.
   */
  const merge = (...levels: ReturnType<typeof visualCheck>[]) =>
    (combineParameters(...levels) as { visualCheck: Record<string, unknown> }).visualCheck

  it('lets the most specific modes list win', () => {
    const preview = visualCheck({ modes: ['narrow'] })
    const meta = visualCheck({ modes: ['narrow', 'wide'] })
    const story = visualCheck({ modes: [] })

    expect(merge(preview, meta).modes).toEqual({ narrow: modes.narrow, wide: modes.wide, dark: null })
    expect(merge(preview, meta, story).modes).toEqual({ narrow: null, wide: null, dark: null })
    expect(merge(preview, visualCheck({ viewport: { width: 1 } })).modes).toEqual({
      narrow: modes.narrow,
      wide: null,
      dark: null,
    })
  })

  it('deep-merges viewport', () => {
    const merged = merge(
      visualCheck({ viewport: { width: 1280, height: 720 } }),
      visualCheck({ viewport: { width: 375 } }),
    )

    expect(merged.viewport).toEqual({ width: 375, height: 720 })
  })

  it('deep-merges tolerance', () => {
    const merged = merge(visualCheck({ tolerance: { color: 0.2 } }), visualCheck({ tolerance: { pixels: 5 } }))

    expect(merged.tolerance).toEqual({ color: 0.2, pixels: 5 })
  })

  it('merges masks by name and drops one with null', () => {
    const preview = visualCheck({ masks: { clock: { selector: '.clock' }, ad: { host: 'ads.example.com' } } })
    const story = visualCheck({ masks: { clock: null, avatar: { selector: '.avatar' } } })

    expect(merge(preview, story).masks).toEqual({
      clock: null,
      ad: { host: 'ads.example.com', selector: null },
      avatar: { selector: '.avatar', host: null },
    })
  })

  it('replaces a mask of the other kind instead of mixing the two', () => {
    const selectorLevel = visualCheck({ masks: { ad: { selector: '.ad' } } })
    const hostLevel = visualCheck({ masks: { ad: { host: 'ads.example.com' } } })

    expect(merge(selectorLevel, hostLevel).masks).toEqual({ ad: { host: 'ads.example.com', selector: null } })
    expect(merge(hostLevel, selectorLevel).masks).toEqual({ ad: { selector: '.ad', host: null } })
  })

  it('drops every inherited mask with masks: null', () => {
    const preview = visualCheck({ masks: { clock: { selector: '.clock' } } })

    expect(merge(preview, visualCheck({ masks: null })).masks).toBeNull()
  })

  it('lets the most specific wait, element and disable win', () => {
    const hook = () => undefined
    const preview = visualCheck({ wait: hook, element: '#root', disable: true })

    expect(merge(preview, visualCheck({ wait: null, element: null, disable: false }))).toMatchObject({
      wait: null,
      element: null,
      disable: false,
    })
    expect(merge(preview, visualCheck({ element: '#story' }))).toMatchObject({
      wait: hook,
      element: '#story',
      disable: true,
    })
  })

  it('lets the most specific defaultCapture win', () => {
    const meta = visualCheck({ defaultCapture: false, modes: ['dark'] })

    expect(merge(meta, visualCheck({ defaultCapture: true })).defaultCapture).toBe(true)
    expect(merge(meta, visualCheck({ disable: false })).defaultCapture).toBe(false)
  })

  it('lets the most specific pageErrors win', () => {
    const preview = visualCheck({ pageErrors: 'warn' })

    expect(merge(preview, visualCheck({ pageErrors: 'off' })).pageErrors).toBe('off')
    expect(merge(preview, visualCheck({ disable: false })).pageErrors).toBe('warn')
  })

  it('lets the most specific realRequests win', () => {
    const preview = visualCheck({ realRequests: 'fail' })

    expect(merge(preview, visualCheck({ realRequests: 'off' })).realRequests).toBe('off')
    expect(merge(preview, visualCheck({ disable: false })).realRequests).toBe('fail')
  })

  it('lets the most specific expectedPageErrors list replace the inherited one', () => {
    const preview = visualCheck({ expectedPageErrors: ['ResizeObserver', /timeout/] })
    const story = visualCheck({ expectedPageErrors: [/\/api\/orders/] })

    expect(merge(preview, story).expectedPageErrors).toEqual([/\/api\/orders/])
    expect(merge(preview, visualCheck({ expectedPageErrors: [] })).expectedPageErrors).toEqual([])
    expect(merge(preview, visualCheck({ disable: false })).expectedPageErrors).toEqual(['ResizeObserver', /timeout/])
  })

  it('keeps an inherited value hidden behind undefined', () => {
    const merged = merge(visualCheck({ element: '#root' }), visualCheck({ element: undefined }))

    expect(merged.element).toBe('#root')
  })
})
