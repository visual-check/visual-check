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

/**
 * The states a story listed, checked: each must be one visual-check forces, and none may repeat.
 *
 * @throws `visual-check: ${owner} can't force "${state}". The states it forces are hover, active, focus-visible, focus-within and focus.`
 * @throws `visual-check: ${owner} lists "${state}" twice.`
 * @public
 */
export function checkedStatesOf(states: readonly unknown[], owner: string): ForcedState[] {
  const checked: ForcedState[] = []

  for (const state of states) {
    if (!isForcedState(state)) {
      throw new Error(
        `visual-check: ${owner} can't force "${String(state)}". The states it forces are hover, active, focus-visible, focus-within and focus.`,
      )
    }

    if (checked.includes(state)) {
      throw new Error(`visual-check: ${owner} lists "${state}" twice.`)
    }

    checked.push(state)
  }

  return checked
}

/**
 * Whether a value is a state visual-check forces.
 */
function isForcedState(value: unknown): value is ForcedState {
  return forcedStates.includes(value as ForcedState)
}
