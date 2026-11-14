import { describe, expect, it } from 'vitest'
import { ConfigError } from './config-error.js'
import { validateConfig } from './validate-config.js'

/**
 * A URL every Storybook in these tests answers at.
 */
const url = 'http://127.0.0.1:6006'

/**
 * The smallest valid config.
 */
const minimal = { storybooks: { web: { url } } }

/**
 * The line every `{ local, ci }` pair on a key that doesn't take one reads after its key.
 */
const cantTakePair =
  "can't take { local, ci }. Only storybooks.<name>.url, workers and readyTimeout differ between local runs and CI."

/**
 * The minimal config with `keys` added at the root.
 */
function withRoot(keys: Record<string, unknown>): Record<string, unknown> {
  return { ...minimal, ...keys }
}

/**
 * A config with one Storybook, `web`, whose settings are `url` plus `settings`.
 */
function withStorybook(settings: Record<string, unknown>): Record<string, unknown> {
  return { storybooks: { web: { url, ...settings } } }
}

/**
 * Validates a config that must be valid and checks that the result equals it.
 */
function expectValid(config: unknown): void {
  expect(validateConfig(config, 'visual-check.config.ts')).toStrictEqual(config)
}

/**
 * Validates a config that must be invalid and returns its `ConfigError`'s message.
 */
function messageOf(value: unknown, displayPath = 'visual-check.config.ts'): string {
  try {
    validateConfig(value, displayPath)
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError)

    return (error as ConfigError).message
  }

  return expect.fail('validateConfig accepted an invalid config')
}

/**
 * Validates a config that must be invalid and returns its issues, one per line, without the header and the bullets.
 */
function issuesOf(value: unknown): string[] {
  const [header, ...lines] = messageOf(value).split('\n')

  expect(header).toBe('visual-check.config.ts is invalid:')

  return lines.map((line) => line.replace(/^ {2}- /, ''))
}

/**
 * Matches one issue on the key at `path` that says what its value must be.
 */
function wrongValue(path: string): unknown {
  return expect.stringMatching(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: must be .+\\. Got .+\\.$`))
}

describe('the config object', () => {
  it('returns a full valid config', () => {
    expectValid({
      storybooks: {
        web: { url: { local: url, ci: 'https://ci.example.com' }, dir: 'apps/web', configDir: '.sb', baselines: 'b' },
        'docs-2': { url: 'https://docs.example.com' },
      },
      platform: 'linux/arm64',
      image: 'ghcr.io/acme/browser:1',
      tolerance: { color: 0.1, pixels: '0.5%' },
      viewport: { width: 375, height: 812, deviceScaleFactor: 2, touch: true },
      maskColor: '#0F0',
      timezone: 'Europe/Warsaw',
      locale: 'pl-PL',
      colorScheme: 'dark',
      workers: { local: 'auto', ci: 2 },
      readyTimeout: { ci: 20_000 },
      retries: 0,
      silenceHosts: ['fonts.example.com', '*.cdn.example.com'],
      affected: { selectAll: ['package.json'], ignore: ['**/*.md'] },
    })
  })

  it('accepts the minimal config', () => {
    expectValid(minimal)
  })

  it('accepts an object with a null prototype', () => {
    expect(validateConfig(Object.assign(Object.create(null), minimal), 'visual-check.config.ts')).toStrictEqual(minimal)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', [minimal]],
    ['a function', () => minimal],
    ['a string', 'config'],
    ['a Date', new Date()],
    ['a class instance', new (class Settings {})()],
  ])('rejects %s as the config', (_label, value) => {
    expect(messageOf(value)).toBe(
      'visual-check.config.ts must export a config object: export default defineConfig({ ... }).',
    )
  })

  it('names the config by its display path', () => {
    expect(messageOf(null, 'apps/visual-check.config.mts')).toMatch(/^apps\/visual-check\.config\.mts must export/)
    expect(messageOf({}, 'apps/visual-check.config.mts')).toMatch(/^apps\/visual-check\.config\.mts is invalid:\n/)
  })

  it('throws a ConfigError named ConfigError', () => {
    expect(() => validateConfig({}, 'visual-check.config.ts')).toThrow(expect.objectContaining({ name: 'ConfigError' }))
  })

  it('lists every issue, one per line', () => {
    expect(messageOf({ storybooks: { web: { url: 'localhost:6006' } }, retries: -1 })).toBe(
      [
        'visual-check.config.ts is invalid:',
        '  - storybooks.web.url: must be an http: or https: URL string, or a { local, ci } pair of those. Got "localhost:6006".',
        '  - retries: must be a whole number of 0 or more. Got -1.',
      ].join('\n'),
    )
  })

  it('reports an unknown key, listing the known ones', () => {
    expect(issuesOf(withRoot({ browser: 'firefox' }))).toEqual([
      'browser: unknown key. Known keys: storybooks, platform, image, tolerance, viewport, maskColor, timezone, ' +
        'locale, colorScheme, workers, readyTimeout, retries, silenceHosts, affected.',
    ])
  })

  it('writes a key that is not a plain name in brackets', () => {
    expect(issuesOf(withRoot({ 'retries ': 1, 'a.b': 2 }))).toEqual([
      expect.stringMatching(/^\["retries "\]: unknown key\./),
      expect.stringMatching(/^\["a\.b"\]: unknown key\./),
    ])
  })

  it('treats a key set to undefined as absent and leaves it out of the result', () => {
    const config = withRoot({ retries: undefined, browser: undefined })

    expect(validateConfig(config, 'visual-check.config.ts')).toStrictEqual(minimal)
  })

  it.each([
    ['a Storybook', { storybooks: { web: undefined, docs: { url } } }, { storybooks: { docs: { url } } }],
    ['a tolerance key', withRoot({ tolerance: { pixels: undefined } }), withRoot({ tolerance: {} })],
    ['a side of a pair', withRoot({ workers: { local: 2, ci: undefined } }), withRoot({ workers: { local: 2 } })],
    [
      'a side of a url pair',
      { storybooks: { web: { url: { local: url, ci: undefined } } } },
      { storybooks: { web: { url: { local: url } } } },
    ],
  ])('leaves out %s set to undefined', (_label, config, expected) => {
    expect(validateConfig(config, 'visual-check.config.ts')).toStrictEqual(expected)
  })

  it('returns a copy', () => {
    const config = withRoot({ silenceHosts: ['example.com'] })
    const result = validateConfig(config, 'visual-check.config.ts')

    expect(result).not.toBe(config)
    expect(result.storybooks).not.toBe(config.storybooks)
    expect(result.silenceHosts).not.toBe(config.silenceHosts)
  })

  it.each([
    ['a string', 'say "hi"\nthen go', '"say \\"hi\\"\\nthen go"'],
    ['a long string', 'x'.repeat(60), `"${'x'.repeat(38)}…`],
    ['a long string of emoji', '😀'.repeat(60), `"${'😀'.repeat(38)}…`],
    [
      'a long object',
      { list: Array.from({ length: 20 }, (_entry, index) => index) },
      '{"list":[0,1,2,3,4,5,6,7,8,9,10,11,12,1…',
    ],
    ['an array of strings', ['a', 'b'], '["a","b"]'],
    ['NaN', Number.NaN, 'NaN'],
    ['Infinity', Number.POSITIVE_INFINITY, 'Infinity'],
    ['a bigint', 10n, '10n'],
    ['a symbol', Symbol('retries'), 'Symbol(retries)'],
    ['a function', () => 1, 'a function'],
    ['null', null, 'null'],
    ['a Date', new Date(0), 'an instance of Date'],
    ['a Map', new Map(), 'an instance of Map'],
    ['a RegExp', /x/, 'an instance of RegExp'],
    ['a URL', new URL(url), 'an instance of URL'],
    ['a class instance', new (class Settings {})(), 'an instance of Settings'],
    ['an object without a class', Object.create(Object.create(null)), 'an object'],
  ])('shows %s briefly in an issue', (_label, value, shown) => {
    expect(issuesOf(withRoot({ retries: value }))).toEqual([
      `retries: must be a whole number of 0 or more. Got ${shown}.`,
    ])
  })

  it('shows a circular object without crashing', () => {
    const circular: Record<string, unknown> = {}

    circular.self = circular

    expect(issuesOf(withRoot({ retries: circular }))).toEqual([
      'retries: must be a whole number of 0 or more. Got an object.',
    ])
  })
})

describe('storybooks', () => {
  it('is required', () => {
    expect(issuesOf({})).toEqual([
      "storybooks: required. Set the Storybooks to capture, such as { web: { url: 'http://127.0.0.1:6006' } }.",
    ])
  })

  it.each([
    ['empty', {}],
    ['only undefined entries', { web: undefined }],
    ['an array', [{ url }]],
    ['a string', url],
  ])('rejects storybooks that is %s', (_label, storybooks) => {
    expect(issuesOf({ storybooks })).toEqual([wrongValue('storybooks')])
  })

  it.each([
    ['Web', 'storybooks.Web'],
    ['my_web', 'storybooks.my_web'],
    ['web app', 'storybooks["web app"]'],
    ['', 'storybooks[""]'],
  ])('rejects the Storybook name %j', (name, path) => {
    expect(issuesOf({ storybooks: { [name]: { url } } })).toEqual([
      `${path}: a Storybook name takes lowercase letters, digits and -.`,
    ])
  })

  it('accepts names with lowercase letters, digits and -, local and ci included', () => {
    expectValid({ storybooks: { 'web-2': { url }, local: { url }, ci: { url } } })
  })

  it.each([
    ['a string', url],
    ['an array', [url]],
  ])('rejects a Storybook that is %s', (_label, settings) => {
    expect(issuesOf({ storybooks: { web: settings } })).toEqual([wrongValue('storybooks.web')])
  })

  it('checks every Storybook', () => {
    expect(issuesOf({ storybooks: { web: { url: 1 }, docs: { url: 2 } } })).toEqual([
      wrongValue('storybooks.web.url'),
      wrongValue('storybooks.docs.url'),
    ])
  })
})

describe('storybooks.<name>', () => {
  it('reports an unknown key', () => {
    expect(issuesOf({ storybooks: { web: { urll: url } } })).toEqual([
      'storybooks.web.urll: unknown key. Known keys: url, dir, configDir, baselines.',
      "storybooks.web.url: required. Set the URL the Storybook answers at, such as 'http://127.0.0.1:6006'.",
    ])
  })

  it('requires url', () => {
    expect(issuesOf({ storybooks: { web: {} } })).toEqual([
      "storybooks.web.url: required. Set the URL the Storybook answers at, such as 'http://127.0.0.1:6006'.",
    ])
  })

  it.each(['http://127.0.0.1:6006', 'https://storybook.example.com/path/'])('accepts the url %s', (value) => {
    expectValid({ storybooks: { web: { url: value } } })
  })

  it.each(['localhost:6006', 'ftp://x', '127.0.0.1:6006', '', 6006])('rejects the url %j', (value) => {
    expect(issuesOf({ storybooks: { web: { url: value } } })).toEqual([wrongValue('storybooks.web.url')])
  })

  it('rejects a url with a login, naming the key and the fix, without the password', () => {
    expect(issuesOf({ storybooks: { web: { url: 'https://user:hunter2@example.com' } } })).toEqual([
      'storybooks.web.url: holds a user name or password. visual-check sends no login: serve Storybook where ' +
        'visual-check runs (storybook dev, or its static build served in the same CI job) and point the URL at that.',
    ])
  })

  it.each([
    ['a plain url', 'https://user:hunter2@example.com', 'storybooks.web.url'],
    ['the local side', { local: 'https://user:hunter2@example.com', ci: url }, 'storybooks.web.url.local'],
    ['the ci side', { local: url, ci: 'https://user:hunter2@example.com' }, 'storybooks.web.url.ci'],
  ])('rejects a login in %s without printing the password', (_label, value, key) => {
    const [issue, ...others] = issuesOf({ storybooks: { web: { url: value } } })

    expect(others).toEqual([])
    expect(issue).toMatch(new RegExp(`^${key.replaceAll('.', '\\.')}: holds a user name or password`))
    expect(messageOf({ storybooks: { web: { url: value } } })).not.toContain('hunter2')
  })

  it.each(['ftp://u:hunter2@h', 'user:hunter2@host:6006'])('never prints the password of the url %j', (secret) => {
    const values = [secret, { local: secret, ci: url }, { local: url, ci: secret }]

    for (const value of values) {
      expect(messageOf({ storybooks: { web: { url: value } } })).not.toContain('hunter2')
    }
  })

  it('leaves out a value with an @ and keeps the requirement, for a plain value and each side', () => {
    const bad = 'user:hunter2@host:6006'

    expect(issuesOf({ storybooks: { web: { url: bad } } })).toEqual([
      'storybooks.web.url: must be an http: or https: URL string, or a { local, ci } pair of those.',
    ])
    expect(issuesOf({ storybooks: { web: { url: { local: bad, ci: url } } } })).toEqual([
      'storybooks.web.url.local: must be an http: or https: URL string.',
    ])
    expect(issuesOf({ storybooks: { web: { url: { local: url, ci: bad } } } })).toEqual([
      'storybooks.web.url.ci: must be an http: or https: URL string.',
    ])
  })

  it.each([
    ['a Storybook that is a URL', { web: 'https://u:hunter2@h.io' }],
    ['storybooks that is a URL', 'https://u:hunter2@h.io'],
    ['a url array', { web: { url: ['https://u:hunter2@h.io'] } }],
    ['a url pair side that is an array', { web: { url: { local: ['https://u:hunter2@h.io'] } } }],
  ])('never prints a password a value holds elsewhere: %s', (_label, storybooks) => {
    const message = messageOf({ storybooks })

    expect(message).toContain('must be')
    expect(message).not.toContain('hunter2')
  })

  it.each([
    ['both sides', { local: url, ci: 'https://ci.example.com' }],
    ['local only', { local: url }],
    ['ci only', { ci: url }],
  ])('accepts a url pair with %s', (_label, pair) => {
    expectValid({ storybooks: { web: { url: pair } } })
  })

  it('names the class of a URL object', () => {
    expect(issuesOf({ storybooks: { web: { url: new URL(url) } } })).toEqual([
      'storybooks.web.url: must be an http: or https: URL string, or a { local, ci } pair of those. Got an instance of URL.',
    ])
  })

  it('checks each side of a url pair', () => {
    expect(issuesOf({ storybooks: { web: { url: { local: url, ci: 'ftp://x' } } } })).toEqual([
      'storybooks.web.url.ci: must be an http: or https: URL string. Got "ftp://x".',
    ])
  })

  it('rejects an empty url pair', () => {
    expect(issuesOf({ storybooks: { web: { url: {} } } })).toEqual([
      'storybooks.web.url: { local, ci } needs local, ci or both.',
    ])
  })

  it('reports an unknown key in a url pair', () => {
    expect(issuesOf({ storybooks: { web: { url: { local: url, prod: url } } } })).toEqual([
      'storybooks.web.url.prod: unknown key. Known keys: local, ci.',
    ])
  })

  it.each([
    ['dir', ''],
    ['dir', 1],
    ['configDir', ''],
    ['configDir', 1],
    ['baselines', ''],
    ['baselines', 1],
  ])('rejects the %s %j', (key, value) => {
    expect(issuesOf(withStorybook({ [key]: value }))).toEqual([wrongValue(`storybooks.web.${key}`)])
  })

  it('rejects a Storybook given as a { local, ci } pair', () => {
    expect(issuesOf({ storybooks: { web: { local: { url }, ci: { url } } } })).toEqual([
      `storybooks.web: ${cantTakePair}`,
    ])
  })
})

describe('{ local, ci } on a key that takes one value', () => {
  it.each([
    ['retries', withRoot({ retries: { local: 1, ci: 2 } })],
    ['retries', withRoot({ retries: { ci: undefined } })],
    ['tolerance', withRoot({ tolerance: { local: { color: 0.1 }, ci: { color: 0.2 } } })],
    ['tolerance', withRoot({ tolerance: { local: undefined } })],
    ['tolerance.pixels', withRoot({ tolerance: { pixels: { ci: 2 } } })],
    ['viewport', withRoot({ viewport: { local: { width: 1 } } })],
    ['platform', withRoot({ platform: { local: 'host', ci: 'linux/amd64' } })],
    ['silenceHosts', withRoot({ silenceHosts: { ci: ['a.test'] } })],
    ['storybooks.web.dir', withStorybook({ dir: { local: 'a', ci: 'b' } })],
  ])('reports %s in %j', (path, config) => {
    expect(issuesOf(config)).toEqual([`${path}: ${cantTakePair}`])
  })

  it('reports local and ci beside other keys as unknown keys', () => {
    expect(issuesOf(withRoot({ tolerance: { local: 0.1, color: 0.1 } }))).toEqual([
      'tolerance.local: unknown key. Known keys: color, pixels.',
    ])
  })
})

describe('platform, image and the emulated browser', () => {
  it.each([
    ['platform', 'linux/amd64'],
    ['platform', 'linux/arm64'],
    ['platform', 'host'],
    ['image', 'ghcr.io/acme/browser:1'],
    ['maskColor', '#FF00FF'],
    ['maskColor', '#f0f'],
    ['maskColor', '#A1b2C3'],
    ['timezone', 'UTC'],
    ['timezone', 'Europe/Warsaw'],
    ['timezone', 'America/New_York'],
    ['locale', 'en-US'],
    ['locale', 'pl'],
    ['locale', 'zh-Hant-TW'],
    ['colorScheme', 'light'],
    ['colorScheme', 'dark'],
  ])('accepts the %s %j', (key, value) => {
    expectValid(withRoot({ [key]: value }))
  })

  it.each([
    ['platform', 'linux'],
    ['platform', 'darwin/arm64'],
    ['platform', 1],
    ['image', ''],
    ['image', 1],
    ['maskColor', 'FF00FF'],
    ['maskColor', '#ff00f'],
    ['maskColor', 'red'],
    ['maskColor', '#ff00ff00'],
    ['timezone', 'Mars/Base'],
    ['timezone', '+01:00'],
    ['timezone', '-05:00'],
    ['timezone', ''],
    ['timezone', 1],
    ['locale', 'en_US'],
    ['locale', ''],
    ['locale', 1],
    ['colorScheme', 'Dark'],
    ['colorScheme', 'auto'],
  ])('rejects the %s %j', (key, value) => {
    expect(issuesOf(withRoot({ [key]: value }))).toEqual([wrongValue(key)])
  })

  it('says what platform, colorScheme and timezone take', () => {
    expect(issuesOf(withRoot({ platform: 'linux', colorScheme: 'auto', timezone: '+01:00' }))).toEqual([
      "platform: must be 'linux/amd64', 'linux/arm64' or 'host'. Got \"linux\".",
      'timezone: must be an IANA time zone name, such as \'Europe/Warsaw\'. Got "+01:00".',
      "colorScheme: must be 'light' or 'dark'. Got \"auto\".",
    ])
  })
})

describe('tolerance', () => {
  it.each([0, 0.01, 1])('accepts the color %s', (color) => {
    expectValid(withRoot({ tolerance: { color } }))
  })

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.1'])('rejects the color %s', (color) => {
    expect(issuesOf(withRoot({ tolerance: { color } }))).toEqual([wrongValue('tolerance.color')])
  })

  it.each([0, 20, '0%', '0.1%', '100%', '100.0%'])('accepts the pixels %j', (pixels) => {
    expectValid(withRoot({ tolerance: { pixels } }))
  })

  it.each([1.5, -1, 2 ** 53, '0.1', '101%', '100.5%', '-1%', '1e2%', '.5%', '%', Number.NaN])(
    'rejects the pixels %j',
    (pixels) => {
      expect(issuesOf(withRoot({ tolerance: { pixels } }))).toEqual([wrongValue('tolerance.pixels')])
    },
  )

  it('says what pixels takes', () => {
    expect(issuesOf(withRoot({ tolerance: { pixels: 1.5 } }))).toEqual([
      "tolerance.pixels: must be a whole number of 0 or more, or a string from '0%' to '100%'. Got 1.5.",
    ])
  })

  it('reports an unknown key', () => {
    expect(issuesOf(withRoot({ tolerance: { threshold: 0.1 } }))).toEqual([
      'tolerance.threshold: unknown key. Known keys: color, pixels.',
    ])
  })

  it.each([0.1, 'strict', [0.1]])('rejects tolerance %j', (tolerance) => {
    expect(issuesOf(withRoot({ tolerance }))).toEqual([wrongValue('tolerance')])
  })
})

describe('viewport', () => {
  it.each([
    ['width', 0],
    ['width', -1],
    ['width', 1.5],
    ['width', '1280'],
    ['height', 0],
    ['height', -1],
    ['height', 1.5],
    ['height', '720'],
  ])('rejects the %s %j', (key, value) => {
    expect(issuesOf(withRoot({ viewport: { [key]: value } }))).toEqual([wrongValue(`viewport.${key}`)])
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '2'])('rejects the deviceScaleFactor %s', (value) => {
    expect(issuesOf(withRoot({ viewport: { deviceScaleFactor: value } }))).toEqual([
      wrongValue('viewport.deviceScaleFactor'),
    ])
  })

  it('accepts a fractional deviceScaleFactor', () => {
    expectValid(withRoot({ viewport: { deviceScaleFactor: 1.5 } }))
  })

  it('rejects a touch that is not a boolean', () => {
    expect(issuesOf(withRoot({ viewport: { touch: 'yes' } }))).toEqual([
      'viewport.touch: must be true or false. Got "yes".',
    ])
  })

  it('reports an unknown key', () => {
    expect(issuesOf(withRoot({ viewport: { isMobile: true } }))).toEqual([
      'viewport.isMobile: unknown key. Known keys: width, height, deviceScaleFactor, touch.',
    ])
  })

  it.each([1280, [1280, 720]])('rejects viewport %j', (viewport) => {
    expect(issuesOf(withRoot({ viewport }))).toEqual([wrongValue('viewport')])
  })
})

describe('workers and readyTimeout', () => {
  it.each([
    ['workers', 'auto'],
    ['workers', 1],
    ['workers', 8],
    ['workers', { local: 'auto', ci: 2 }],
    ['workers', { local: 4 }],
    ['workers', { ci: 'auto' }],
    ['readyTimeout', 1],
    ['readyTimeout', 10_000],
    ['readyTimeout', 2_147_483_647],
    ['readyTimeout', { local: 5_000, ci: 20_000 }],
    ['readyTimeout', { local: 1 }],
    ['readyTimeout', { ci: 1 }],
  ])('accepts the %s %j', (key, value) => {
    expectValid(withRoot({ [key]: value }))
  })

  it.each([
    ['workers', 0],
    ['workers', 1.5],
    ['workers', 'max'],
    ['workers', '4'],
    ['readyTimeout', 0],
    ['readyTimeout', -1],
    ['readyTimeout', 1.5],
    ['readyTimeout', 2_147_483_648],
    ['readyTimeout', '10s'],
    ['readyTimeout', 'auto'],
  ])('rejects the %s %j', (key, value) => {
    expect(issuesOf(withRoot({ [key]: value }))).toEqual([wrongValue(key)])
  })

  it('checks each side of a pair', () => {
    expect(issuesOf(withRoot({ workers: { local: 0, ci: 'max' } }))).toEqual([
      "workers.local: must be 'auto' or a whole number of 1 or more. Got 0.",
      'workers.ci: must be \'auto\' or a whole number of 1 or more. Got "max".',
    ])
    expect(issuesOf(withRoot({ readyTimeout: { ci: 2_147_483_648 } }))).toEqual([
      'readyTimeout.ci: must be a whole number from 1 to 2147483647. Got 2147483648.',
    ])
  })

  it.each(['workers', 'readyTimeout'])('rejects an empty %s pair', (key) => {
    expect(issuesOf(withRoot({ [key]: {} }))).toEqual([`${key}: { local, ci } needs local, ci or both.`])
    expect(issuesOf(withRoot({ [key]: { local: undefined } }))).toEqual([
      `${key}: { local, ci } needs local, ci or both.`,
    ])
  })

  it('reports an unknown key in a pair', () => {
    expect(issuesOf(withRoot({ workers: { local: 2, staging: 4 } }))).toEqual([
      'workers.staging: unknown key. Known keys: local, ci.',
    ])
  })
})

describe('retries', () => {
  it.each([0, 3])('accepts %s', (retries) => {
    expectValid(withRoot({ retries }))
  })

  it.each([-1, 1.5, 2 ** 53, '1'])('rejects %j', (retries) => {
    expect(issuesOf(withRoot({ retries }))).toEqual([wrongValue('retries')])
  })
})

describe('silenceHosts', () => {
  it('accepts exact hosts and *. patterns', () => {
    expectValid(withRoot({ silenceHosts: ['example.com', '*.example.com', 'localhost:8080'] }))
  })

  it.each([
    '',
    '*',
    '*.',
    '*example.com',
    'cdn.*.example.com',
    '*.*.example.com',
    'https://example.com',
    'example.com/path',
    'example .com',
    1,
    undefined,
  ])('rejects the host %j', (host) => {
    expect(issuesOf(withRoot({ silenceHosts: ['example.com', host] }))).toEqual([wrongValue('silenceHosts[1]')])
  })

  it('rejects a hole in the array', () => {
    const silenceHosts: string[] = []

    silenceHosts[1] = 'example.com'

    expect(issuesOf(withRoot({ silenceHosts }))).toEqual([wrongValue('silenceHosts[0]')])
  })

  it.each(['example.com', { host: 'example.com' }])('rejects silenceHosts %j', (silenceHosts) => {
    expect(issuesOf(withRoot({ silenceHosts }))).toEqual([wrongValue('silenceHosts')])
  })
})

describe('affected', () => {
  it('accepts globs', () => {
    expectValid(withRoot({ affected: { selectAll: ['package.json', 'src/theme/**'], ignore: [] } }))
  })

  it.each(['selectAll', 'ignore'])('rejects a %s that is not an array of non-empty strings', (key) => {
    expect(issuesOf(withRoot({ affected: { [key]: 'package.json' } }))).toEqual([wrongValue(`affected.${key}`)])
    expect(issuesOf(withRoot({ affected: { [key]: ['a', '', 1] } }))).toEqual([
      wrongValue(`affected.${key}[1]`),
      wrongValue(`affected.${key}[2]`),
    ])
  })

  it('reports an unknown key', () => {
    expect(issuesOf(withRoot({ affected: { include: ['src/**'] } }))).toEqual([
      'affected.include: unknown key. Known keys: selectAll, ignore.',
    ])
  })

  it('rejects affected that is not an object', () => {
    expect(issuesOf(withRoot({ affected: ['package.json'] }))).toEqual([wrongValue('affected')])
  })
})
