/**
 * When a hook's effect runs, and where its failures go.
 */
export interface HookContext {
  /**
   * Whether the effect should run: while there is a request.
   */
  isActive: () => boolean
  /**
   * Reports an effect that threw, so the page's call never fails for it.
   */
  warn: (message: string) => void
}

/**
 * Wraps a prototype's method so it calls the earlier one with the same `this` and arguments, then, while active, runs
 * the effect on its result, and returns the result. A missing prototype or method is skipped.
 */
export function hookMethod<Target, Result>(
  prototype: Target | undefined,
  name: string,
  context: HookContext,
  effect: (target: Target, result: Result) => void,
): void {
  const methods = prototype as Record<string, unknown> | undefined
  const previous = methods?.[name]

  if (methods === undefined || typeof previous !== 'function') {
    return
  }

  methods[name] = function hooked(this: Target, ...args: unknown[]): Result {
    const result: Result = previous.apply(this, args)

    runEffect(context, name, () => effect(this, result))

    return result
  }
}

/**
 * Wraps a prototype's accessor so its setter calls the earlier one, then, while active, runs the effect. A missing
 * descriptor or setter is skipped.
 */
export function hookSetter<Target>(
  prototype: Target,
  name: string,
  context: HookContext,
  effect: (target: Target) => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
  const previous = descriptor?.set

  if (descriptor === undefined || previous === undefined) {
    return
  }

  Object.defineProperty(prototype, name, {
    ...descriptor,
    set(this: Target, value: unknown) {
      previous.call(this, value)
      runEffect(context, name, () => effect(this))
    },
  })
}

/**
 * Runs the effect while active, reporting what it throws instead of throwing.
 */
export function runEffect(context: HookContext, name: string, effect: () => void): void {
  if (!context.isActive()) {
    return
  }

  try {
    effect()
  } catch (error) {
    context.warn(`visual-check: couldn't force states after ${name}: ${String(error)}`)
  }
}
