import { describe, expect, it, vi } from 'vitest'
import { type HookContext, hookMethod, hookSetter } from './prototype-hooks.js'

/**
 * What the hooked prototypes' instances hold.
 */
interface Target {
  /**
   * Added to every sum.
   */
  offset: number
  /**
   * What `setting` was set to.
   */
  value: unknown
  /**
   * Adds the numbers to the offset, or throws for a negative one.
   */
  add(left: number, right: number): number
  /**
   * Sets `value`.
   */
  setting: unknown
}

/**
 * A fresh prototype with `add` and a `setting` accessor, hooked with the effect, and an instance of it.
 */
function hooked(active = true, effect: (...args: unknown[]) => void = () => undefined) {
  const prototype = {
    add(this: Target, left: number, right: number): number {
      if (left < 0) {
        throw new Error('negative')
      }

      return this.offset + left + right
    },
    set setting(value: unknown) {
      ;(this as unknown as Target).value = value
    },
  }
  const warn = vi.fn<(message: string) => void>()
  const effects = vi.fn(effect)
  const context: HookContext = { isActive: () => active, warn }

  hookMethod(prototype, 'add', context, effects)
  hookSetter(prototype, 'setting', context, effects)

  return { instance: Object.assign(Object.create(prototype) as Target, { offset: 10 }), effects, warn }
}

describe('hookMethod', () => {
  it('calls the earlier method with the same this and arguments, runs the effect, and returns the result', () => {
    const { instance, effects } = hooked()

    expect(instance.add(1, 2)).toBe(13)
    expect(effects.mock.calls).toEqual([[instance, 13]])
  })

  it('lets what the earlier method throws reach the caller, and skips the effect', () => {
    const { instance, effects } = hooked()

    expect(() => instance.add(-1, 2)).toThrow('negative')
    expect(effects).not.toHaveBeenCalled()
  })

  it('warns about an effect that throws instead of throwing', () => {
    const { instance, warn } = hooked(true, () => {
      throw new Error('broken')
    })

    expect(instance.add(1, 2)).toBe(13)
    expect(warn.mock.calls).toEqual([["visual-check: couldn't force states after add: Error: broken"]])
  })

  it('skips a missing prototype or method', () => {
    const prototype = {}
    const context: HookContext = { isActive: () => true, warn: () => undefined }

    hookMethod(undefined, 'add', context, () => undefined)
    hookMethod(prototype, 'add', context, () => undefined)

    expect(prototype).toEqual({})
  })
})

describe('hookSetter', () => {
  it('calls the earlier setter with the same this and value, then runs the effect', () => {
    const { instance, effects } = hooked()

    instance.setting = 'x'

    expect(instance.value).toBe('x')
    expect(effects.mock.calls).toEqual([[instance]])
  })

  it('skips a missing descriptor or setter', () => {
    const prototype = {
      get only(): number {
        return 1
      },
    }
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'only')
    const context: HookContext = { isActive: () => true, warn: () => undefined }

    hookSetter(prototype, 'missing', context, () => undefined)
    hookSetter(prototype, 'only', context, () => undefined)

    expect(Object.getOwnPropertyDescriptor(prototype, 'missing')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(prototype, 'only')).toEqual(descriptor)
  })
})

it('runs neither effect while inactive', () => {
  const { instance, effects } = hooked(false)

  instance.add(1, 2)
  instance.setting = 'x'

  expect(effects).not.toHaveBeenCalled()
  expect(instance.value).toBe('x')
})
