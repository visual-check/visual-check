import { describe, expect, it } from 'vitest'
import { checkStoryOptions, type StoryOptions } from './story-options.js'
import { UnrunnableRegExp } from './unrunnable-regexp.js'

/**
 * The hint an unknown key directly under `visualCheck` ends with.
 */
const newerHint = ' If a newer @visual-check/storybook wrote it, install @visual-check/cli at the same version.'

/**
 * The known keys an unknown-key issue lists at the top level.
 */
const topKeys =
  'modes, viewport, element, growViewport, allowOverflow, masks, tolerance, disable, pageErrors, expectedPageErrors, wait'

/**
 * Checks a value that must be valid and returns its options.
 */
function optionsOf(value: unknown): unknown {
  const result = checkStoryOptions(value)

  if (!('options' in result)) {
    return expect.fail(`checkStoryOptions rejected the value: ${result.issues.join(' | ')}`)
  }

  return result.options
}

/**
 * Checks a value that must be invalid and returns its issues.
 */
function issuesOf(value: unknown): string[] {
  const result = checkStoryOptions(value)

  if (!('issues' in result)) {
    return expect.fail('checkStoryOptions accepted an invalid value')
  }

  return result.issues
}

/**
 * A class named like a built-in, so an issue renders it by name.
 */
const FakeDate = { Date: class {} }.Date

/**
 * A class named like `RegExp` that isn't one, as the decoder builds for an instance the page encoded by its name.
 */
const FakeRegExp = { RegExp: class {} }.RegExp

describe('checkStoryOptions', () => {
  describe('the value', () => {
    it('takes undefined as no options', () => {
      expect(optionsOf(undefined)).toStrictEqual({})
    })

    it('takes an empty object', () => {
      expect(optionsOf({})).toStrictEqual({})
    })

    it('takes an object without a prototype', () => {
      expect(optionsOf(Object.assign(Object.create(null), { disable: true }))).toStrictEqual({ disable: true })
    })

    it.each([
      [null, 'null'],
      [[], '[]'],
      ['dark', '"dark"'],
      [3, '3'],
      [new FakeDate(), 'an instance of Date'],
    ])('rejects %j that is not a plain object', (value, shown) => {
      expect(issuesOf(value)).toStrictEqual([
        `visualCheck: must be an object, as visualCheck({ ... }) from <configDir>/visual-check.ts writes. Got ${shown}.`,
      ])
    })

    it('ignores keys set to undefined', () => {
      expect(optionsOf({ element: undefined, extra: undefined, tolerance: { pixels: undefined } })).toStrictEqual({
        tolerance: {},
      })
    })
  })

  describe('unknown keys', () => {
    it('adds the newer-helper hint at the top level', () => {
      expect(issuesOf({ retries: 1 })).toStrictEqual([
        `visualCheck.retries: unknown key. Known keys: ${topKeys}.${newerHint}`,
      ])
    })

    it('adds no hint below the top level', () => {
      expect(issuesOf({ viewport: { depth: 1 } })).toStrictEqual([
        'visualCheck.viewport.depth: unknown key. Known keys: width, height, deviceScaleFactor, touch.',
      ])
    })

    it('reads an odd key as a bracketed path', () => {
      expect(issuesOf({ 'a b': 1 })).toHaveLength(1)
      expect(issuesOf({ 'a b': 1 })[0]).toMatch(/^visualCheck\["a b"\]: unknown key\./)
    })

    it('reports unknown keys in a tolerance, a mode and a mask', () => {
      expect(
        issuesOf({
          tolerance: { colour: 1 },
          modes: { dark: { theme: 'dark' } },
          masks: { logo: { selector: '.a', color: 'red' } },
        }),
      ).toStrictEqual([
        'visualCheck.modes.dark.theme: unknown key. Known keys: globals, viewport.',
        'visualCheck.masks.logo.color: unknown key. Known keys: selector, host.',
        'visualCheck.tolerance.colour: unknown key. Known keys: color, pixels.',
      ])
    })
  })

  describe('modes', () => {
    it('takes definitions and null', () => {
      const modes = {
        dark: { globals: { theme: 'dark', size: 2, on: true }, viewport: { width: 375 } },
        mobile: null,
        plain: {},
      }

      expect(optionsOf({ modes })).toStrictEqual({ modes })
    })

    it('takes an empty object', () => {
      expect(optionsOf({ modes: {} })).toStrictEqual({ modes: {} })
    })

    it('reports an array of mode names as the wrong shape', () => {
      expect(issuesOf({ modes: ['dark'] })).toStrictEqual([
        'visualCheck.modes: must be an object with one entry per declared mode, as visualCheck({ modes: [...] }) writes. Got ["dark"].',
      ])
    })

    it.each([null, 'dark', 3, true])('rejects %j for modes', (modes) => {
      expect(issuesOf({ modes })).toHaveLength(1)
      expect(issuesOf({ modes })[0]).toMatch(/^visualCheck\.modes: must be an object with one entry per declared mode/)
    })

    it.each([
      ['dark', '"dark"'],
      [3, '3'],
      [[], '[]'],
      [true, 'true'],
    ])('rejects %j as a mode entry', (entry, shown) => {
      expect(issuesOf({ modes: { dark: entry } })).toStrictEqual([
        `visualCheck.modes.dark: must be a mode definition such as { globals: { theme: 'dark' } }, or null. Got ${shown}.`,
      ])
    })

    it('rejects globals that are not an object', () => {
      expect(issuesOf({ modes: { dark: { globals: ['a'] } } })).toStrictEqual([
        `visualCheck.modes.dark.globals: must be an object of globals, such as { theme: 'dark' }. Got ["a"].`,
      ])
    })

    it.each([
      [null, 'null'],
      [Number.NaN, 'NaN'],
      [Number.POSITIVE_INFINITY, 'Infinity'],
      [{}, '{}'],
      [() => 1, 'a function'],
      [10n, '10n'],
    ])('rejects %s as a global value', (global, shown) => {
      expect(issuesOf({ modes: { dark: { globals: { theme: global } } } })).toStrictEqual([
        `visualCheck.modes.dark.globals.theme: must be a string, a finite number or a boolean. Got ${shown}.`,
      ])
    })

    it('checks a mode viewport with the viewport rules', () => {
      expect(issuesOf({ modes: { mobile: { viewport: { width: 0 } } } })).toStrictEqual([
        'visualCheck.modes.mobile.viewport.width: must be a whole number of 1 or more. Got 0.',
      ])
    })

    it('does not check mode names, reserved names or global values', () => {
      expect(optionsOf({ modes: { chromium: { globals: { 'a b': 'x y!' } } } })).toStrictEqual({
        modes: { chromium: { globals: { 'a b': 'x y!' } } },
      })
    })

    it('leaves out entries set to undefined', () => {
      expect(optionsOf({ modes: { dark: undefined, light: null } })).toStrictEqual({ modes: { light: null } })
    })
  })

  describe('viewport', () => {
    it('takes every key', () => {
      const viewport = { width: 375, height: 667, deviceScaleFactor: 2.5, touch: true }

      expect(optionsOf({ viewport })).toStrictEqual({ viewport })
    })

    it.each([null, 'wide', [], 4, new FakeDate()])('rejects %j as a viewport', (viewport) => {
      expect(issuesOf({ viewport })).toHaveLength(1)
      expect(issuesOf({ viewport })[0]).toMatch(
        /^visualCheck\.viewport: must be an object such as \{ width: 1280, height: 720 \}\. Got /,
      )
    })

    it.each([
      [{ width: 0 }, 'width: must be a whole number of 1 or more. Got 0.'],
      [{ width: 1.5 }, 'width: must be a whole number of 1 or more. Got 1.5.'],
      [{ width: '10' }, 'width: must be a whole number of 1 or more. Got "10".'],
      [{ width: null }, 'width: must be a whole number of 1 or more. Got null.'],
      [{ height: -1 }, 'height: must be a whole number of 1 or more. Got -1.'],
      [{ deviceScaleFactor: 0 }, 'deviceScaleFactor: must be a number greater than 0. Got 0.'],
      [{ deviceScaleFactor: Number.NaN }, 'deviceScaleFactor: must be a number greater than 0. Got NaN.'],
      [{ touch: 'yes' }, 'touch: must be true or false. Got "yes".'],
    ])('rejects %j', (viewport, issue) => {
      expect(issuesOf({ viewport })).toStrictEqual([`visualCheck.viewport.${issue}`])
    })

    it('reports a { local, ci } pair as a wrong type', () => {
      expect(issuesOf({ viewport: { width: { local: 1, ci: 2 } } })).toStrictEqual([
        'visualCheck.viewport.width: must be a whole number of 1 or more. Got {"local":1,"ci":2}.',
      ])
    })
  })

  describe('element', () => {
    it('takes a selector and null', () => {
      expect(optionsOf({ element: '#root' })).toStrictEqual({ element: '#root' })
      expect(optionsOf({ element: null })).toStrictEqual({ element: null })
    })

    it.each([
      ['', '""'],
      [3, '3'],
      [true, 'true'],
      [[], '[]'],
    ])('rejects %j', (element, shown) => {
      expect(issuesOf({ element })).toStrictEqual([
        `visualCheck.element: must be a non-empty string, or null. Got ${shown}.`,
      ])
    })
  })

  describe('masks', () => {
    it('takes null and an empty object', () => {
      expect(optionsOf({ masks: null })).toStrictEqual({ masks: null })
      expect(optionsOf({ masks: {} })).toStrictEqual({ masks: {} })
    })

    it('takes selector masks, host masks and null entries', () => {
      const masks = { ad: { selector: '.ad' }, map: { host: 'maps.example.com' }, old: null }

      expect(optionsOf({ masks })).toStrictEqual({ masks })
    })

    it('returns a helper-written mask with one key', () => {
      const masks = { ad: { selector: '.a', host: null }, map: { selector: null, host: 'x.com' } }

      expect(optionsOf({ masks })).toStrictEqual({ masks: { ad: { selector: '.a' }, map: { host: 'x.com' } } })
    })

    it('takes a mask with the unused key undefined', () => {
      expect(optionsOf({ masks: { ad: { selector: '.a', host: undefined } } })).toStrictEqual({
        masks: { ad: { selector: '.a' } },
      })
    })

    it.each([[[]], ['ad'], [3], [true]])('rejects %j as masks', (masks) => {
      expect(issuesOf({ masks })).toHaveLength(1)
      expect(issuesOf({ masks })[0]).toMatch(/^visualCheck\.masks: must be an object of masks by name, or null\. Got /)
    })

    it.each([
      [{ selector: '.a', host: 'x' }, '{"selector":".a","host":"x"}'],
      [{}, '{}'],
      [{ selector: '' }, '{"selector":""}'],
      [{ host: '' }, '{"host":""}'],
      [{ selector: 1 }, '{"selector":1}'],
      [{ selector: null, host: null }, '{"selector":null,"host":null}'],
      [{ selector: '.a', host: '' }, '{"selector":".a","host":""}'],
      [{ host: 2, selector: '.a' }, '{"host":2,"selector":".a"}'],
      ['.a', '".a"'],
      [3, '3'],
      [[], '[]'],
      [true, 'true'],
    ])('rejects the mask %j', (mask, shown) => {
      expect(issuesOf({ masks: { logo: mask } })).toStrictEqual([
        `visualCheck.masks.logo: must be { selector: '<selector>' } or { host: '<host>' }, or null to drop it. Got ${shown}.`,
      ])
    })

    it('reports only the unknown key of a mask that has one', () => {
      expect(issuesOf({ masks: { logo: { colour: 'x' } } })).toStrictEqual([
        'visualCheck.masks.logo.colour: unknown key. Known keys: selector, host.',
      ])
      expect(issuesOf({ masks: { logo: { selector: 1, colour: 'x' } } })).toStrictEqual([
        'visualCheck.masks.logo.colour: unknown key. Known keys: selector, host.',
      ])
    })

    it('reads an odd mask name as a bracketed path', () => {
      expect(issuesOf({ masks: { 'a b': {} } })).toHaveLength(1)
      expect(issuesOf({ masks: { 'a b': {} } })[0]).toMatch(/^visualCheck\.masks\["a b"\]: must be/)
    })
  })

  describe('tolerance', () => {
    it('takes valid values', () => {
      expect(optionsOf({ tolerance: { color: 0.5, pixels: 3 } })).toStrictEqual({
        tolerance: { color: 0.5, pixels: 3 },
      })
    })

    it.each([0, 1, 0.25])('takes color %j', (color) => {
      expect(optionsOf({ tolerance: { color } })).toStrictEqual({ tolerance: { color } })
    })

    it.each([-0.1, 1.1, '0.5', null, Number.NaN])('rejects color %j', (color) => {
      expect(issuesOf({ tolerance: { color } })).toHaveLength(1)
      expect(issuesOf({ tolerance: { color } })[0]).toMatch(
        /^visualCheck\.tolerance\.color: must be a number from 0 to 1\. Got /,
      )
    })

    it.each([0, 1, 20, '0%', '100%', '12.5%', '50%'])('takes pixels %j', (pixels) => {
      expect(optionsOf({ tolerance: { pixels } })).toStrictEqual({ tolerance: { pixels } })
    })

    it.each([-1, 1.5, '101%', '50 %', '-1%', '50', '%', null, true, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects pixels %j',
      (pixels) => {
        expect(issuesOf({ tolerance: { pixels } })).toHaveLength(1)
        expect(issuesOf({ tolerance: { pixels } })[0]).toMatch(
          /^visualCheck\.tolerance\.pixels: must be a whole number of 0 or more, or a string from '0%' to '100%'\. Got /,
        )
      },
    )

    it.each([null, 'loose', [], 3])('rejects %j as a tolerance', (tolerance) => {
      expect(issuesOf({ tolerance })).toHaveLength(1)
      expect(issuesOf({ tolerance })[0]).toMatch(
        /^visualCheck\.tolerance: must be an object such as \{ color: 0\.01, pixels: 20 \}\. Got /,
      )
    })
  })

  describe('growViewport', () => {
    it('takes true and false', () => {
      expect(optionsOf({ growViewport: true })).toStrictEqual({ growViewport: true })
      expect(optionsOf({ growViewport: false })).toStrictEqual({ growViewport: false })
    })

    it.each([null, 'false', 0, {}])('rejects %j', (growViewport) => {
      expect(issuesOf({ growViewport })).toHaveLength(1)
      expect(issuesOf({ growViewport })[0]).toMatch(/^visualCheck\.growViewport: must be true or false\. Got /)
    })
  })

  describe('allowOverflow', () => {
    it('takes true and false', () => {
      expect(optionsOf({ allowOverflow: true })).toStrictEqual({ allowOverflow: true })
      expect(optionsOf({ allowOverflow: false })).toStrictEqual({ allowOverflow: false })
    })

    it.each([null, 'true', 1, 0, {}])('rejects %j', (allowOverflow) => {
      expect(issuesOf({ allowOverflow })).toHaveLength(1)
      expect(issuesOf({ allowOverflow })[0]).toMatch(/^visualCheck\.allowOverflow: must be true or false\. Got /)
    })
  })

  describe('disable', () => {
    it('takes true and false', () => {
      expect(optionsOf({ disable: true })).toStrictEqual({ disable: true })
      expect(optionsOf({ disable: false })).toStrictEqual({ disable: false })
    })

    it.each([null, 'true', 1, 0, []])('rejects %j', (disable) => {
      expect(issuesOf({ disable })).toHaveLength(1)
      expect(issuesOf({ disable })[0]).toMatch(/^visualCheck\.disable: must be true or false\. Got /)
    })
  })

  describe('pageErrors', () => {
    it.each(['fail', 'warn', 'off'])('takes %s', (pageErrors) => {
      expect(optionsOf({ pageErrors })).toStrictEqual({ pageErrors })
    })

    it.each([null, 'error', true, []])('rejects %j', (pageErrors) => {
      expect(issuesOf({ pageErrors })).toStrictEqual([
        expect.stringMatching(/^visualCheck\.pageErrors: must be 'fail', 'warn' or 'off'\. Got /),
      ])
    })
  })

  describe('expectedPageErrors', () => {
    it('takes strings and regular expressions, keeping each as it is, and an empty array', () => {
      const pattern = /\/api\/orders/i
      const options = optionsOf({ expectedPageErrors: ['Failed to fetch', pattern] }) as StoryOptions

      expect(options).toStrictEqual({ expectedPageErrors: ['Failed to fetch', pattern] })
      expect(options.expectedPageErrors?.[1]).toBe(pattern)
      expect(optionsOf({ expectedPageErrors: [] })).toStrictEqual({ expectedPageErrors: [] })
    })

    it.each([
      ['an empty string', ''],
      ['a number', 1],
      ['null', null],
      ['a plain object', { source: 'x', flags: '' }],
      ['an instance of a class named RegExp, as an instance the page encoded decodes', new FakeRegExp()],
    ])('rejects %s as an entry, naming its index', (_label, entry) => {
      expect(issuesOf({ expectedPageErrors: [/timeout/, entry] })).toStrictEqual([
        expect.stringMatching(
          /^visualCheck\.expectedPageErrors\[1\]: must be a non-empty string or a regular expression\. Got /,
        ),
      ])
    })

    it('rejects a regular expression from the page that Node.js could not build, as a literal', () => {
      expect(
        issuesOf({ expectedPageErrors: ['Failed to fetch', new UnrunnableRegExp('(?i:timeout)', 'g')] }),
      ).toStrictEqual([
        'visualCheck.expectedPageErrors[1]: must be a regular expression Node.js can run. Got /(?i:timeout)/g.',
      ])
    })

    it.each(['Failed to fetch', /Failed/, null])(
      'rejects expectedPageErrors %j that is not an array',
      (expectedPageErrors) => {
        expect(issuesOf({ expectedPageErrors })).toStrictEqual([
          expect.stringMatching(
            /^visualCheck\.expectedPageErrors: must be an array of strings or regular expressions, /,
          ),
        ])
      },
    )
  })

  describe('wait', () => {
    it('takes a function and null, and leaves wait out', () => {
      expect(optionsOf({ wait: () => undefined })).toStrictEqual({})
      expect(optionsOf({ wait: null })).toStrictEqual({})
    })

    it.each(['go', 3, true, {}, []])('rejects %j', (wait) => {
      expect(issuesOf({ wait })).toHaveLength(1)
      expect(issuesOf({ wait })[0]).toMatch(
        /^visualCheck\.wait: must be a function that takes the story's context, or null to turn an inherited one off\. Got /,
      )
    })
  })

  describe('rendering', () => {
    it('renders a function as a function', () => {
      expect(issuesOf({ element: () => 1 })).toStrictEqual([
        'visualCheck.element: must be a non-empty string, or null. Got a function.',
      ])
    })

    it('renders an instance by its class', () => {
      expect(issuesOf({ element: new FakeDate() })).toStrictEqual([
        'visualCheck.element: must be a non-empty string, or null. Got an instance of Date.',
      ])
    })
  })

  describe('a whole value', () => {
    it('returns typed options without wait', () => {
      const options = {
        modes: { dark: { globals: { theme: 'dark' } }, mobile: null },
        viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true },
        element: null,
        growViewport: false,
        allowOverflow: true,
        masks: { ad: { selector: '.ad', host: null }, old: null },
        tolerance: { color: 0.02, pixels: '1%' },
        disable: false,
        pageErrors: 'warn',
        expectedPageErrors: ['Failed to fetch', /timeout/],
        wait: () => undefined,
        retired: undefined,
      }

      expect(optionsOf(options)).toStrictEqual({
        modes: { dark: { globals: { theme: 'dark' } }, mobile: null },
        viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true },
        element: null,
        growViewport: false,
        allowOverflow: true,
        masks: { ad: { selector: '.ad' }, old: null },
        tolerance: { color: 0.02, pixels: '1%' },
        disable: false,
        pageErrors: 'warn',
        expectedPageErrors: ['Failed to fetch', /timeout/],
      })
    })

    it('reports every issue', () => {
      expect(
        issuesOf({ retries: 1, viewport: { width: 0 }, element: '', tolerance: { pixels: -1 }, disable: 'no' }),
      ).toStrictEqual([
        `visualCheck.retries: unknown key. Known keys: ${topKeys}.${newerHint}`,
        'visualCheck.viewport.width: must be a whole number of 1 or more. Got 0.',
        'visualCheck.element: must be a non-empty string, or null. Got "".',
        "visualCheck.tolerance.pixels: must be a whole number of 0 or more, or a string from '0%' to '100%'. Got -1.",
        'visualCheck.disable: must be true or false. Got "no".',
      ])
    })
  })
})
