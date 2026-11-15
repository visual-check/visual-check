import { describe, expect, it } from 'vitest'
import { checkModeRules, type ModeRulesStory } from './mode-rules.js'
import type { StoryOptions } from './story-options.js'

/**
 * The modes of a story, as its validated options hold them.
 */
type Modes = NonNullable<StoryOptions['modes']>

/**
 * The fix a mode-name issue ends with.
 */
const renameFix = 'Rename it in <configDir>/visual-check.ts.'

/**
 * What a bad mode name's issue says after its key path.
 */
const badNameText = `a mode name takes lowercase letters, digits and -. ${renameFix}`

/**
 * What a reserved mode name's issue says after its key path.
 */
const reservedNameText = `chromium, webkit and firefox are kept for browsers' baselines, so no mode can take them. ${renameFix}`

/**
 * What a bad string value's issue says after its key path, before the value.
 */
const badStringText =
  "must be a string of only letters, digits, spaces, _ and -, or Storybook drops it from the story's URL."

/**
 * What a bad global name's issue says after its key path.
 */
const badKeyText =
  "a global's name may hold only letters, digits, spaces, _ and -, and can't be empty, or Storybook drops it from the story's URL."

/**
 * The issue of a global `key` that Storybook `web` doesn't declare, at `path` in `storyId`.
 */
function undeclaredOf(storyId: string, path: string, key: string): string {
  return `${storyId}: ${path}: Storybook web doesn't declare the global ${key}, so it would drop it from the story's URL. Add ${key} to initialGlobals or globalTypes in <configDir>/preview.`
}

/**
 * The issue of a global `key` that `storyId` pins while its mode `mode` sets it.
 */
function pinnedOf(storyId: string, mode: string, key: string): string {
  return `${storyId}: visualCheck.modes.${mode}.globals.${key}: the story or its meta pins ${key} in its own globals, which win over the mode's, so the mode's ${key} never reaches the story. Leave ${mode} out of the story's modes, or ${key} out of its globals.`
}

/**
 * The issue for a mode `dark` set to `here` in `storyId` but to `there` in `firstStoryId`.
 */
function conflictOf(storyId: string, here: string, there: string, firstStoryId: string): string {
  return `${storyId}: visualCheck.modes.dark: sets ${here} here but ${there} in ${firstStoryId}. A mode means one thing in a Storybook, so declare it once in <configDir>/visual-check.ts.`
}

/**
 * The globals the Storybook in most tests declares.
 */
const declared: ReadonlySet<string> = new Set(['theme', 'density', 'locale'])

/**
 * Builds a story with the given modes and pinned globals.
 */
function storyOf(id: string, modes: Modes, pinnedGlobals: string[] = []): ModeRulesStory {
  return { id, options: { modes }, pinnedGlobals }
}

/**
 * Checks the stories of the Storybook `web`, which declares `declared`.
 */
function issuesOf(...stories: ModeRulesStory[]): string[] {
  return checkModeRules('web', stories, declared)
}

describe('checkModeRules', () => {
  it('gives no issue for stories without modes', () => {
    expect(checkModeRules('web', [{ id: 'a--one', options: {}, pinnedGlobals: [] }], declared)).toStrictEqual([])
  })

  describe('names', () => {
    it.each(['dark', 'mobile-2', 'a'])('takes %j', (name) => {
      expect(issuesOf(storyOf('a--one', { [name]: { globals: { theme: 'dark' } } }))).toStrictEqual([])
    })

    it.each([
      ['Dark', 'visualCheck.modes.Dark'],
      ['dark_mode', 'visualCheck.modes.dark_mode'],
      ['dark mode', 'visualCheck.modes["dark mode"]'],
      ['über', 'visualCheck.modes["über"]'],
      ['', 'visualCheck.modes[""]'],
    ])('rejects %j', (name, path) => {
      expect(issuesOf(storyOf('a--one', { [name]: {} }))).toStrictEqual([`a--one: ${path}: ${badNameText}`])
    })

    it.each(['chromium', 'webkit', 'firefox'])('rejects the reserved %j', (name) => {
      expect(issuesOf(storyOf('a--one', { [name]: {} }))).toStrictEqual([
        `a--one: visualCheck.modes.${name}: ${reservedNameText}`,
      ])
    })

    it('rejects a bad name the story leaves out', () => {
      expect(issuesOf(storyOf('a--one', { Dark: null, firefox: null }))).toStrictEqual([
        `a--one: visualCheck.modes.Dark: ${badNameText}`,
        `a--one: visualCheck.modes.firefox: ${reservedNameText}`,
      ])
    })

    it('reports a bad name once, on the first story that holds it', () => {
      expect(
        issuesOf(
          storyOf('a--one', { Dark: null }),
          storyOf('a--two', { Dark: { globals: { theme: 'dark' } } }),
          storyOf('a--three', { Dark: { globals: { theme: 'a/b', font: 'x' } } }, ['theme']),
        ),
      ).toStrictEqual([`a--one: visualCheck.modes.Dark: ${badNameText}`])
    })
  })

  describe('one meaning per Storybook', () => {
    it('names the first story that lists the mode', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: { viewport: { width: 400 } } }),
          storyOf('a--two', { dark: { viewport: { width: 375 } } }),
        ),
      ).toStrictEqual([conflictOf('a--two', '{"viewport":{"width":375}}', '{"viewport":{"width":400}}', 'a--one')])
    })

    it('reports each later story against the first', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: { globals: { theme: 'dark' } } }),
          storyOf('a--two', { dark: { globals: { theme: 'light' } } }),
          storyOf('a--three', { dark: { globals: { theme: 'dim' } } }),
        ),
      ).toStrictEqual([
        conflictOf('a--two', '{"globals":{"theme":"light"}}', '{"globals":{"theme":"dark"}}', 'a--one'),
        conflictOf('a--three', '{"globals":{"theme":"dim"}}', '{"globals":{"theme":"dark"}}', 'a--one'),
      ])
    })

    it('ignores the order of keys', () => {
      expect(
        issuesOf(
          storyOf('a--one', {
            dark: { globals: { theme: 'dark', density: 2 }, viewport: { width: 400, height: 800 } },
          }),
          storyOf('a--two', {
            dark: { viewport: { height: 800, width: 400 }, globals: { density: 2, theme: 'dark' } },
          }),
        ),
      ).toStrictEqual([])
    })

    it('reads absent globals and viewport as empty', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: {} }),
          storyOf('a--two', { dark: { globals: {} } }),
          storyOf('a--three', { dark: { viewport: {} } }),
        ),
      ).toStrictEqual([])
    })

    it('tells a viewport from empty globals', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: { globals: {} } }),
          storyOf('a--two', { dark: { viewport: { touch: true } } }),
        ),
      ).toStrictEqual([conflictOf('a--two', '{"viewport":{"touch":true}}', '{"globals":{}}', 'a--one')])
    })

    it('reads -0 as 0', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: { globals: { density: -0 } } }),
          storyOf('a--two', { dark: { globals: { density: 0 } } }),
        ),
      ).toStrictEqual([])
    })

    it('tells a number from a string', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: { globals: { density: 2 } } }),
          storyOf('a--two', { dark: { globals: { density: '2' } } }),
        ),
      ).toStrictEqual([conflictOf('a--two', '{"globals":{"density":"2"}}', '{"globals":{"density":2}}', 'a--one')])
    })

    it('never compares a mode the story leaves out', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: null }),
          storyOf('a--two', { dark: { globals: { theme: 'dark' } } }),
          storyOf('a--three', { dark: null }),
        ),
      ).toStrictEqual([])
    })
  })

  describe('undeclared globals', () => {
    it('rejects a global the Storybook does not declare', () => {
      expect(issuesOf(storyOf('a--one', { dark: { globals: { theme: 'dark', backgrounds: 'dark' } } }))).toStrictEqual([
        undeclaredOf('a--one', 'visualCheck.modes.dark.globals.backgrounds', 'backgrounds'),
      ])
    })

    it('reports a mode once, on the first story that lists it', () => {
      const modes: Modes = { dark: { globals: { backgrounds: 'dark' } } }

      expect(
        issuesOf(
          storyOf('a--one', { dark: null }),
          storyOf('a--two', modes),
          storyOf('a--three', modes),
          storyOf('a--four', modes),
        ),
      ).toStrictEqual([undeclaredOf('a--two', 'visualCheck.modes.dark.globals.backgrounds', 'backgrounds')])
    })

    it('skips the check when the declared globals are unknown', () => {
      expect(
        checkModeRules('web', [storyOf('a--one', { dark: { globals: { backgrounds: 'dark' } } })], null),
      ).toStrictEqual([])
    })
  })

  describe('characters', () => {
    it.each([['dark mode'], ['dark_mode-2'], [''], [1.5], [-2], [0], [true], [false]])(
      'takes the value %j',
      (value) => {
        expect(issuesOf(storyOf('a--one', { dark: { globals: { theme: value } } }))).toStrictEqual([])
      },
    )

    it.each([
      ['a/b', '"a/b"'],
      ['a.b', '"a.b"'],
    ])('rejects the string %j', (value, shown) => {
      expect(issuesOf(storyOf('a--one', { dark: { globals: { theme: value } } }))).toStrictEqual([
        `a--one: visualCheck.modes.dark.globals.theme: ${badStringText} Got ${shown}.`,
      ])
    })

    it.each([
      [1e21, '1e+21'],
      [0.0000001, '1e-7'],
      [Number.POSITIVE_INFINITY, 'Infinity'],
      [Number.NaN, 'NaN'],
    ])('rejects the number %j', (value, shown) => {
      expect(issuesOf(storyOf('a--one', { dark: { globals: { theme: value } } }))).toStrictEqual([
        `a--one: visualCheck.modes.dark.globals.theme: must be a number in plain decimal digits, such as 1.5 or -2, or Storybook doesn't read it from the story's URL as a number. Got ${shown}.`,
      ])
    })

    it.each([
      ['a/b', 'visualCheck.modes.dark.globals["a/b"]'],
      ['a.b', 'visualCheck.modes.dark.globals["a.b"]'],
      ['', 'visualCheck.modes.dark.globals[""]'],
    ])('rejects the key %j', (key, path) => {
      expect(checkModeRules('web', [storyOf('a--one', { dark: { globals: { [key]: 'dark' } } })], null)).toStrictEqual([
        `a--one: ${path}: ${badKeyText}`,
      ])
    })

    it('reports a bad key before a bad value', () => {
      expect(checkModeRules('web', [storyOf('a--one', { dark: { globals: { 'a/b': 'c.d' } } })], null)).toStrictEqual([
        `a--one: visualCheck.modes.dark.globals["a/b"]: ${badKeyText}`,
        `a--one: visualCheck.modes.dark.globals["a/b"]: ${badStringText} Got "c.d".`,
      ])
    })

    it('reports a mode once, on the first story that lists it', () => {
      const modes: Modes = { dark: { globals: { theme: 'a/b' } } }

      expect(issuesOf(storyOf('a--one', modes), storyOf('a--two', modes))).toStrictEqual([
        `a--one: visualCheck.modes.dark.globals.theme: ${badStringText} Got "a/b".`,
      ])
    })

    it('takes a key with spaces, _ and -', () => {
      expect(
        checkModeRules('web', [storyOf('a--one', { dark: { globals: { 'my theme_2-b': 'dark' } } })], null),
      ).toStrictEqual([])
    })
  })

  describe('pinned globals', () => {
    it('rejects a global the story pins', () => {
      expect(
        issuesOf(storyOf('a--one', { dark: { globals: { theme: 'dark', density: 2 } } }, ['theme'])),
      ).toStrictEqual([pinnedOf('a--one', 'dark', 'theme')])
    })

    it('reports each story that pins the global', () => {
      const modes: Modes = { dark: { globals: { theme: 'dark' } } }

      expect(
        issuesOf(storyOf('a--one', modes, ['theme']), storyOf('a--two', modes), storyOf('a--three', modes, ['theme'])),
      ).toStrictEqual([pinnedOf('a--one', 'dark', 'theme'), pinnedOf('a--three', 'dark', 'theme')])
    })

    it('takes a mode that sets only a viewport', () => {
      expect(issuesOf(storyOf('a--one', { mobile: { viewport: { width: 375 } } }, ['theme']))).toStrictEqual([])
    })

    it('skips a mode the story leaves out', () => {
      expect(
        issuesOf(
          storyOf('a--one', { dark: { globals: { theme: 'dark' } } }),
          storyOf('a--two', { dark: null }, ['theme']),
        ),
      ).toStrictEqual([])
    })
  })

  it('gives a story its issues in rule order, then entry order', () => {
    expect(
      issuesOf(
        storyOf('a--one', { dark: { globals: { theme: 'dark' } } }),
        storyOf(
          'a--two',
          {
            dark: { globals: { theme: 'a/b', backgrounds: 'x' } },
            Wide: { viewport: { width: 1600 } },
            light: { globals: { theme: 'light', font: 'a.b', size: 'x/y' } },
          },
          ['theme'],
        ),
        storyOf('a--three', { firefox: null, Wide: { viewport: { width: 1600 } } }),
      ),
    ).toStrictEqual([
      `a--two: visualCheck.modes.Wide: ${badNameText}`,
      conflictOf('a--two', '{"globals":{"theme":"a/b","backgrounds":"x"}}', '{"globals":{"theme":"dark"}}', 'a--one'),
      undeclaredOf('a--two', 'visualCheck.modes.light.globals.font', 'font'),
      undeclaredOf('a--two', 'visualCheck.modes.light.globals.size', 'size'),
      `a--two: visualCheck.modes.light.globals.font: ${badStringText} Got "a.b".`,
      `a--two: visualCheck.modes.light.globals.size: ${badStringText} Got "x/y".`,
      pinnedOf('a--two', 'dark', 'theme'),
      pinnedOf('a--two', 'light', 'theme'),
      `a--three: visualCheck.modes.firefox: ${reservedNameText}`,
    ])
  })
})
