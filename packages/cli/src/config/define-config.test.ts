import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type AffectedSettings,
  type Config,
  defineConfig,
  type StorybookSettings,
  type Tolerance,
  type Viewport,
} from './define-config.js'

/**
 * The keys of `T` that accept a `{ local, ci }` pair.
 */
type KeysTakingPair<T> = { [K in keyof T]-?: { local: never; ci: never } extends T[K] ? K : never }[keyof T]

// The type cases below are checked by `tsc` (`test:type`), not at run time.
describe('defineConfig', () => {
  it('returns its argument unchanged', () => {
    const config = { storybooks: { web: { url: 'http://localhost:6006' } } }

    expect(defineConfig(config)).toBe(config)
  })

  it('accepts a local and ci pair on url, workers and readyTimeout', () => {
    defineConfig({ storybooks: { web: { url: { local: 'http://localhost:6006', ci: 'http://localhost:7007' } } } })
    defineConfig({ storybooks: {}, workers: { local: 'auto', ci: 2 } })
    defineConfig({ storybooks: {}, readyTimeout: { local: 5_000, ci: 20_000 } })
  })

  it('accepts a share string for tolerance pixels', () => {
    defineConfig({ storybooks: {}, tolerance: { pixels: '0.1%' } })
  })

  it('rejects a local and ci pair on every other key', () => {
    // @ts-expect-error retries takes one value
    defineConfig({ storybooks: {}, retries: { local: 1, ci: 2 } })
    // @ts-expect-error platform takes one value
    defineConfig({ storybooks: {}, platform: { local: 'host', ci: 'linux/amd64' } })
    // @ts-expect-error tolerance takes one value
    defineConfig({ storybooks: {}, tolerance: { local: { color: 0.1 }, ci: { color: 0.2 } } })
    // @ts-expect-error tolerance.pixels takes one value
    defineConfig({ storybooks: {}, tolerance: { pixels: { local: 1, ci: 2 } } })
    // @ts-expect-error viewport takes one value
    defineConfig({ storybooks: {}, viewport: { local: { width: 1 }, ci: { width: 2 } } })
    // @ts-expect-error maskColor takes one value
    defineConfig({ storybooks: {}, maskColor: { local: '#000000', ci: '#FFFFFF' } })
    // @ts-expect-error timezone takes one value
    defineConfig({ storybooks: {}, timezone: { local: 'UTC', ci: 'Europe/Warsaw' } })
    // @ts-expect-error dir takes one value
    defineConfig({ storybooks: { web: { url: 'http://localhost:6006', dir: { local: 'a', ci: 'b' } } } })
    // @ts-expect-error silenceHosts takes one value
    defineConfig({ storybooks: {}, silenceHosts: { local: ['a.test'], ci: ['b.test'] } })
  })

  it('rejects unknown keys', () => {
    // @ts-expect-error unknown top-level key
    defineConfig({ storybooks: {}, unknown: true })
    // @ts-expect-error unknown Storybook key
    defineConfig({ storybooks: { web: { url: 'http://localhost:6006', unknown: true } } })
  })

  it('requires a url and rejects a third side on it', () => {
    // @ts-expect-error url is required
    defineConfig({ storybooks: { web: {} } })
    // @ts-expect-error url takes only local and ci
    defineConfig({ storybooks: { web: { url: { local: 'http://localhost:6006', prod: 'https://example.com' } } } })
  })

  it('lets only url, workers and readyTimeout take a pair (ADR 0005)', () => {
    // `storybooks` is left out: a Record accepts `local` and `ci` as Storybook names.
    expectTypeOf<KeysTakingPair<Omit<Config, 'storybooks'>>>().toEqualTypeOf<'workers' | 'readyTimeout'>()
    expectTypeOf<KeysTakingPair<StorybookSettings>>().toEqualTypeOf<'url'>()
    expectTypeOf<KeysTakingPair<Tolerance> | KeysTakingPair<Viewport> | KeysTakingPair<AffectedSettings>>().toBeNever()
  })

  it('requires a side in a pair', () => {
    // @ts-expect-error url needs a side
    defineConfig({ storybooks: { web: { url: {} } } })
    // @ts-expect-error workers needs a side
    defineConfig({ storybooks: {}, workers: {} })
  })
})
