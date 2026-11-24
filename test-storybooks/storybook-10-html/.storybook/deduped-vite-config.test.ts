import { describe, expect, it } from 'vitest'
import { dedupedViteConfig } from './deduped-vite-config.ts'

describe('dedupedViteConfig', () => {
  it('adds the packages after those the config already dedupes, keeping the rest of the config', () => {
    const config = { root: '/project', resolve: { alias: { a: 'b' }, dedupe: ['react'] } }

    expect(dedupedViteConfig(config, ['storybook', 'vue'])).toEqual({
      root: '/project',
      resolve: { alias: { a: 'b' }, dedupe: ['react', 'storybook', 'vue'] },
    })
  })

  it('dedupes only the packages when the config has no resolve options', () => {
    expect(dedupedViteConfig({}, ['storybook'])).toEqual({ resolve: { dedupe: ['storybook'] } })
  })

  it('leaves the given config unchanged', () => {
    const config = { resolve: { dedupe: ['react'] } }

    dedupedViteConfig(config, ['storybook'])

    expect(config).toEqual({ resolve: { dedupe: ['react'] } })
  })
})
