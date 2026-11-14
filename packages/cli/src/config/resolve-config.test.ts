import { describe, expect, it } from 'vitest'
import { ConfigError } from './config-error.js'
import type { Config, LocalAndCi, StorybookSettings } from './define-config.js'
import { resolveConfig } from './resolve-config.js'

/**
 * A URL every Storybook in these tests answers at.
 */
const url = 'http://127.0.0.1:6006'

/**
 * The config file every test resolves against.
 */
const path = '/repo/visual-check.config.ts'

/**
 * Resolves a config in a local run from the repo's root folder, unless the options say otherwise.
 */
function resolve(config: Config, options: { ci?: boolean; cwd?: string } = {}) {
  return resolveConfig(config, { path, cwd: '/repo', ci: false, ...options })
}

/**
 * Resolves a config that must be unusable and returns its `ConfigError`'s message.
 */
function messageOf(config: Config, options: { ci?: boolean; cwd?: string } = {}): string {
  try {
    resolve(config, options)
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError)

    return (error as ConfigError).message
  }

  throw new Error('Expected resolveConfig to throw')
}

describe('resolveConfig defaults', () => {
  it('fills in every default on the minimal config', () => {
    expect(resolve({ storybooks: { web: { url } } })).toStrictEqual({
      path,
      storybooks: [
        {
          name: 'web',
          dir: '/repo',
          configDir: '/repo/.storybook',
          baselines: '/repo/.visual-check/baselines',
          url,
        },
      ],
      platform: 'linux/amd64',
      image: undefined,
      tolerance: { color: 0.01, pixels: 20 },
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
      maskColor: '#FF00FF',
      timezone: 'UTC',
      locale: 'en-US',
      colorScheme: 'light',
      workers: 'auto',
      readyTimeout: 10_000,
      retries: 1,
      silenceHosts: [],
      affected: { selectAll: [], ignore: [] },
    })
  })

  it('keeps the values the config sets', () => {
    const resolved = resolve({
      storybooks: { web: { url } },
      platform: 'host',
      image: 'my-image',
      maskColor: '#000',
      timezone: 'Europe/Warsaw',
      locale: 'pl-PL',
      colorScheme: 'dark',
      retries: 3,
      silenceHosts: ['*.example.com'],
    })
    expect(resolved).toMatchObject({
      platform: 'host',
      image: 'my-image',
      maskColor: '#000',
      timezone: 'Europe/Warsaw',
      locale: 'pl-PL',
      colorScheme: 'dark',
      retries: 3,
      silenceHosts: ['*.example.com'],
    })
  })

  it('merges tolerance, viewport and affected key by key over their defaults', () => {
    const resolved = resolve({
      storybooks: { web: { url } },
      tolerance: { pixels: '1%' },
      viewport: { width: 800, touch: true },
      affected: { ignore: ['docs/**'] },
    })
    expect(resolved.tolerance).toStrictEqual({ color: 0.01, pixels: '1%' })
    expect(resolved.viewport).toStrictEqual({ width: 800, height: 720, deviceScaleFactor: 1, touch: true })
    expect(resolved.affected).toStrictEqual({ selectAll: [], ignore: ['docs/**'] })
  })

  it('merges affected when only selectAll is set', () => {
    const resolved = resolve({ storybooks: { web: { url } }, affected: { selectAll: ['package.json'] } })
    expect(resolved.affected).toStrictEqual({ selectAll: ['package.json'], ignore: [] })
  })

  it('does not let the result change the config', () => {
    const silenceHosts = ['a.example.com']
    const resolved = resolve({ storybooks: { web: { url } }, silenceHosts })
    resolved.silenceHosts.push('b.example.com')
    expect(silenceHosts).toStrictEqual(['a.example.com'])
  })

  it('does not share default arrays between calls', () => {
    const first = resolve({ storybooks: { web: { url } } })
    const second = resolve({ storybooks: { web: { url } } })
    first.silenceHosts.push('example.com')
    first.affected.selectAll.push('a')
    first.affected.ignore.push('b')
    expect(second.silenceHosts).toStrictEqual([])
    expect(second.affected).toStrictEqual({ selectAll: [], ignore: [] })
    expect(resolve({ storybooks: { web: { url } } }).silenceHosts).toStrictEqual([])
  })

  it('keeps the Storybooks in config order', () => {
    const resolved = resolve({
      storybooks: { zeta: { url, dir: 'z' }, alpha: { url, dir: 'a' }, mid: { url, dir: 'm' } },
    })
    expect(resolved.storybooks.map((storybook) => storybook.name)).toStrictEqual(['zeta', 'alpha', 'mid'])
  })
})

describe('resolveConfig local and CI values', () => {
  /**
   * Builds a config with one Storybook whose one key holds the value under test.
   */
  const pairs = {
    url: (value: string | LocalAndCi<string>): Config => ({ storybooks: { web: { url: value } } }),
    workers: (value: NonNullable<Config['workers']>): Config => ({ storybooks: { web: { url } }, workers: value }),
    readyTimeout: (value: NonNullable<Config['readyTimeout']>): Config => ({
      storybooks: { web: { url } },
      readyTimeout: value,
    }),
  }

  it('picks the side the run is on for the url', () => {
    const config = pairs.url({ local: 'http://127.0.0.1:6006', ci: 'http://storybook:6006' })
    expect(resolve(config).storybooks[0]?.url).toBe('http://127.0.0.1:6006')
    expect(resolve(config, { ci: true }).storybooks[0]?.url).toBe('http://storybook:6006')
  })

  it('serves a plain url to both sides', () => {
    expect(resolve(pairs.url(url), { ci: true }).storybooks[0]?.url).toBe(url)
  })

  it('picks the side for workers, and a missing side takes the default', () => {
    expect(resolve(pairs.workers({ local: 2, ci: 4 })).workers).toBe(2)
    expect(resolve(pairs.workers({ local: 2, ci: 4 }), { ci: true }).workers).toBe(4)
    expect(resolve(pairs.workers({ local: 2 }), { ci: true }).workers).toBe('auto')
    expect(resolve(pairs.workers({ ci: 4 })).workers).toBe('auto')
    expect(resolve(pairs.workers(3), { ci: true }).workers).toBe(3)
  })

  it('picks the side for readyTimeout, and a missing side takes the default', () => {
    expect(resolve(pairs.readyTimeout({ local: 5000, ci: 30_000 })).readyTimeout).toBe(5000)
    expect(resolve(pairs.readyTimeout({ local: 5000, ci: 30_000 }), { ci: true }).readyTimeout).toBe(30_000)
    expect(resolve(pairs.readyTimeout({ local: 5000 }), { ci: true }).readyTimeout).toBe(10_000)
    expect(resolve(pairs.readyTimeout({ ci: 30_000 })).readyTimeout).toBe(10_000)
    expect(resolve(pairs.readyTimeout(7000), { ci: true }).readyTimeout).toBe(7000)
  })

  it('rejects a Storybook with no url for CI', () => {
    expect(messageOf(pairs.url({ local: url }), { ci: true })).toBe(
      "visual-check.config.ts can't be used:\n  - Storybook web has no URL for CI. Set storybooks.web.url.ci.",
    )
  })

  it('rejects a Storybook with no url for local runs', () => {
    expect(messageOf(pairs.url({ ci: url }))).toBe(
      "visual-check.config.ts can't be used:\n  - Storybook web has no URL for local runs. Set storybooks.web.url.local.",
    )
  })

  it('names the config file relative to the current folder', () => {
    expect(messageOf(pairs.url({ local: url }), { ci: true, cwd: '/repo/packages' })).toBe(
      "../visual-check.config.ts can't be used:\n  - Storybook web has no URL for CI. Set storybooks.web.url.ci.",
    )
  })
})

describe('resolveConfig paths', () => {
  /**
   * The first resolved Storybook of a config with one Storybook.
   */
  function only(settings: Partial<Pick<StorybookSettings, 'dir' | 'configDir' | 'baselines'>>) {
    return resolve({ storybooks: { web: { url, ...settings } } }).storybooks[0]
  }

  it('resolves a relative dir from the config file folder', () => {
    expect(only({ dir: 'apps/web' })).toMatchObject({
      dir: '/repo/apps/web',
      configDir: '/repo/apps/web/.storybook',
      baselines: '/repo/apps/web/.visual-check/baselines',
    })
  })

  it('resolves configDir and baselines from dir', () => {
    expect(only({ dir: 'apps/web', configDir: 'sb', baselines: 'shots' })).toMatchObject({
      configDir: '/repo/apps/web/sb',
      baselines: '/repo/apps/web/shots',
    })
  })

  it('resolves from the config file folder, not the current folder', () => {
    const resolved = resolveConfig(
      { storybooks: { web: { url, dir: 'web' } } },
      { path: '/repo/sub/visual-check.config.ts', cwd: '/elsewhere', ci: false },
    )
    expect(resolved.storybooks[0]?.dir).toBe('/repo/sub/web')
  })

  it('resolves a relative config path from the current folder, not the process folder', () => {
    const resolved = resolveConfig(
      { storybooks: { web: { url, dir: 'web' } } },
      { path: 'sub/visual-check.config.ts', cwd: '/repo', ci: false },
    )
    expect(resolved.storybooks[0]?.dir).toBe('/repo/sub/web')
    expect(resolved.path).toBe('/repo/sub/visual-check.config.ts')
    expect(() =>
      resolveConfig(
        { storybooks: { web: { url: { ci: url } } } },
        { path: 'sub/visual-check.config.ts', cwd: '/repo', ci: false },
      ),
    ).toThrow("sub/visual-check.config.ts can't be used:")
  })

  it('keeps absolute paths as they are', () => {
    expect(only({ dir: '/abs/dir' })?.dir).toBe('/abs/dir')
    expect(only({ configDir: '/abs/config' })?.configDir).toBe('/abs/config')
    expect(only({ baselines: '/abs/baselines' })?.baselines).toBe('/abs/baselines')
  })
})

/**
 * The message of a config that fails with these issues, as the config file `visual-check.config.ts` reports them.
 */
function issuesMessage(...issues: string[]): string {
  return ["visual-check.config.ts can't be used:", ...issues.map((issue) => `  - ${issue}`)].join('\n')
}

describe('resolveConfig shared baselines', () => {
  it('rejects two Storybooks with no dir', () => {
    expect(messageOf({ storybooks: { web: { url }, ui: { url } } })).toBe(
      issuesMessage(
        'Storybooks web and ui both keep baselines in .visual-check/baselines. Give each its own dir or baselines.',
      ),
    )
  })

  it('accepts Storybooks with different dirs', () => {
    expect(() => resolve({ storybooks: { web: { url, dir: 'web' }, ui: { url, dir: 'ui' } } })).not.toThrow()
  })

  it('rejects baselines that reach one folder through different relative paths', () => {
    expect(
      messageOf({
        storybooks: { web: { url, dir: 'a', baselines: '../shared' }, ui: { url, dir: 'b', baselines: '../shared' } },
      }),
    ).toBe(issuesMessage('Storybooks web and ui both keep baselines in shared. Give each its own dir or baselines.'))
  })

  it('rejects baselines that differ only in how the path is written', () => {
    expect(messageOf({ storybooks: { web: { url, baselines: 'shots/' }, ui: { url, baselines: './shots' } } })).toBe(
      issuesMessage('Storybooks web and ui both keep baselines in shots. Give each its own dir or baselines.'),
    )
  })

  it('rejects an absolute baselines that is another Storybook default', () => {
    expect(
      messageOf({
        storybooks: { web: { url }, ui: { url, dir: 'ui', baselines: '/repo/.visual-check/baselines' } },
      }),
    ).toBe(
      issuesMessage(
        'Storybooks web and ui both keep baselines in .visual-check/baselines. Give each its own dir or baselines.',
      ),
    )
  })

  it('names all three Storybooks that share one folder', () => {
    expect(messageOf({ storybooks: { web: { url }, ui: { url }, docs: { url } } })).toBe(
      issuesMessage(
        'Storybooks web, ui and docs all keep baselines in .visual-check/baselines. Give each its own dir or baselines.',
      ),
    )
  })

  it('shows the folder relative to the current folder', () => {
    expect(messageOf({ storybooks: { web: { url }, ui: { url } } }, { cwd: '/repo/sub' })).toBe(
      "../visual-check.config.ts can't be used:\n  - Storybooks web and ui both keep baselines in " +
        '../.visual-check/baselines. Give each its own dir or baselines.',
    )
  })

  it('names the current folder when the folder is the current folder', () => {
    expect(
      messageOf({ storybooks: { web: { url, baselines: '.' }, ui: { url, baselines: '.' } } }, { cwd: '/repo' }),
    ).toBe(
      issuesMessage(
        'Storybooks web and ui both keep baselines in the current folder. Give each its own dir or baselines.',
      ),
    )
  })

  it('reports every clash', () => {
    expect(
      messageOf({
        storybooks: {
          a: { url, baselines: 'one' },
          b: { url, baselines: 'one' },
          c: { url, baselines: 'two' },
          d: { url, baselines: 'two' },
        },
      }),
    ).toBe(
      issuesMessage(
        'Storybooks a and b both keep baselines in one. Give each its own dir or baselines.',
        'Storybooks c and d both keep baselines in two. Give each its own dir or baselines.',
      ),
    )
  })
})

describe('resolveConfig with several problems', () => {
  it('reports every Storybook missing a url, one per line', () => {
    expect(
      messageOf({ storybooks: { web: { url: { ci: url }, dir: 'web' }, ui: { url: { ci: url }, dir: 'ui' } } }),
    ).toBe(
      issuesMessage(
        'Storybook web has no URL for local runs. Set storybooks.web.url.local.',
        'Storybook ui has no URL for local runs. Set storybooks.ui.url.local.',
      ),
    )
  })

  it('reports a missing url and a clash together', () => {
    expect(messageOf({ storybooks: { web: { url: { ci: url } }, ui: { url }, docs: { url } } })).toBe(
      issuesMessage(
        'Storybook web has no URL for local runs. Set storybooks.web.url.local.',
        'Storybooks web, ui and docs all keep baselines in .visual-check/baselines. Give each its own dir or baselines.',
      ),
    )
  })
})
