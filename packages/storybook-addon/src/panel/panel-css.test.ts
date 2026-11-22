import { convert, themes } from 'storybook/theming'
import { describe, expect, it } from 'vitest'
import { panelCssOf } from './panel-css.js'

describe('panelCssOf', () => {
  it.each(['light', 'dark'] as const)('finds every value it reads in the %s theme', (name) => {
    const css = panelCssOf(convert(themes[name]))

    expect(css).not.toMatch(/undefined|NaN|\[object/)
  })

  it("draws the statuses in colours that stand out from the theme's background", () => {
    const { color } = convert(themes.light)

    expect(panelCssOf(convert(themes.light))).toContain(`"status"] { color: ${color.negativeText}; }`)
    expect(panelCssOf(convert(themes.dark))).toContain(`"status"] { color: ${color.negative}; }`)
  })
})
