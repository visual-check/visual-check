/**
 * An interaction state visual-check can force on what's inside an element carrying its class.
 *
 * @public
 */
export type ForcedState = 'hover' | 'active' | 'focus-visible' | 'focus-within' | 'focus'

/**
 * Every state visual-check forces, in the order the docs list them. Also the order of the classes in a host twin.
 *
 * @public
 */
export const forcedStates: readonly ForcedState[] = ['hover', 'active', 'focus-visible', 'focus-within', 'focus']

/**
 * The class that forces a state on what's inside it: `visual-check-<state>`.
 *
 * @public
 */
export function forcedStateClassOf(state: ForcedState): string {
  return `visual-check-${state}`
}
