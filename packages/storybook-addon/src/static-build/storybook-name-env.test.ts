import { logger } from 'storybook/internal/node-logger'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storybookNameEnvOf } from './storybook-name-env.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('storybookNameEnvOf', () => {
  it('gives the same config in storybook dev, and reads no config', async () => {
    const config = { STORYBOOK_A: 'a' }
    const nameOf = vi.fn(async () => 'web')

    expect(await storybookNameEnvOf(config, { configType: 'DEVELOPMENT', configDir: '/dev/.storybook' }, nameOf)).toBe(
      config,
    )
    expect(nameOf).not.toHaveBeenCalled()
  })

  it("adds the Storybook's name in a static build, and keeps the other keys", async () => {
    const nameOf = vi.fn(async () => 'web')

    expect(
      await storybookNameEnvOf({ STORYBOOK_A: 'a' }, { configType: 'PRODUCTION', configDir: '/a/.storybook' }, nameOf),
    ).toEqual({ STORYBOOK_A: 'a', VISUAL_CHECK_STORYBOOK: 'web' })
    expect(nameOf).toHaveBeenCalledWith({
      configDir: '/a/.storybook',
      cwd: process.cwd(),
      signal: expect.any(AbortSignal),
    })
  })

  it('adds an empty name when it finds none, and warns once why', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const nameOf = vi.fn(async () => {
      throw new Error('No config')
    })
    const options = { configType: 'PRODUCTION', configDir: '/b/.storybook' } as const

    await storybookNameEnvOf({}, options, nameOf)

    expect(await storybookNameEnvOf({}, options, nameOf)).toEqual({ VISUAL_CHECK_STORYBOOK: '' })
    expect(warn.mock.calls).toEqual([
      [
        "visual-check couldn't name this Storybook from its config, so the static build's panel will say to run " +
          'visual-check init: No config',
      ],
    ])
  })

  it('reads the config of one folder once', async () => {
    const nameOf = vi.fn(async () => 'web')
    const options = { configType: 'PRODUCTION', configDir: '/c/.storybook' } as const

    await storybookNameEnvOf({}, options, nameOf)

    expect(await storybookNameEnvOf({ STORYBOOK_A: 'a' }, options, nameOf)).toEqual({
      STORYBOOK_A: 'a',
      VISUAL_CHECK_STORYBOOK: 'web',
    })
    expect(nameOf).toHaveBeenCalledTimes(1)
  })
})
