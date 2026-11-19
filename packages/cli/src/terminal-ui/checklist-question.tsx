import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { Choice } from '../init/prompter.js'
import { ChoiceLine } from './choice-line.js'
import { ColouredText } from './coloured-text.js'
import { type QuestionProps, stepOf, useLatestState, useQuestionInput } from './question.js'
import { QuestionHeader } from './question-header.js'
import { glyphs } from './theme.js'

/**
 * What `ChecklistQuestion` takes. `defaultValue` is the values of the choices ticked at the start.
 */
interface ChecklistQuestionProps extends QuestionProps<string[]> {
  /**
   * The answers, in the order they show. There is at least one.
   */
  choices: readonly [Choice<string>, ...Choice<string>[]]
  /**
   * Returns what is wrong with the values ticked, or `undefined` when they are fine. A wrong answer stays open to be
   * changed.
   */
  validate?: ((values: string[]) => string | undefined) | undefined
}

/**
 * What a checklist question holds while it is open.
 */
interface ChecklistState {
  /**
   * The position of the choice the pointer is on.
   */
  highlighted: number
  /**
   * Whether each choice is ticked, in the order of the choices.
   */
  ticked: readonly boolean[]
  /**
   * What `validate` found wrong with the last answer, until the next key press that changes a tick. `undefined` when
   * nothing is.
   */
  error: string | undefined
}

/**
 * The keys a checklist question answers to, drawn dim under the choices.
 */
const legend = "<space> to tick, 'a' for all, <enter> to confirm"

/**
 * Asks the person to tick any of a list. ↑/↓ or k/j move the pointer, wrapping round at the ends, Space ticks or
 * unticks the choice it is on, `a` or `A` ticks all, or unticks all when all are ticked, and Enter answers with the
 * values ticked, in the order of the choices. When `validate` finds them wrong, its message shows and the question
 * stays open. Other keys with Ctrl or Meta do nothing.
 */
export function ChecklistQuestion({
  message,
  choices,
  defaultValue,
  hint,
  onSubmit,
  onCancel,
  validate,
}: ChecklistQuestionProps): ReactNode {
  const state = useLatestState<ChecklistState>({
    highlighted: 0,
    ticked: choices.map((choice) => defaultValue.includes(choice.value)),
    error: undefined,
  })
  const drawn = state.value

  /**
   * Answers with the values ticked, unless `validate` finds them wrong.
   */
  function submit(): void {
    const current = state.latest()
    const values = choices.filter((_choice, index) => current.ticked[index]).map((choice) => choice.value)
    const problem = validate?.(values)

    if (problem === undefined) {
      onSubmit(values)
    } else {
      state.set({ ...current, error: problem })
    }
  }

  useQuestionInput(onCancel, (input, key) => {
    const current = state.latest()
    const step = stepOf(input, key)

    if (key.return) {
      submit()
    } else if (step !== 0) {
      state.set({ ...current, highlighted: (current.highlighted + step + choices.length) % choices.length })
    } else if (input === ' ') {
      state.set({
        ...current,
        ticked: current.ticked.map((tick, index) => (index === current.highlighted ? !tick : tick)),
        error: undefined,
      })
    } else if (input.toLowerCase() === 'a') {
      const all = current.ticked.every(Boolean)

      state.set({ ...current, ticked: current.ticked.map(() => !all), error: undefined })
    }
  })

  return (
    <Box flexDirection="column">
      <QuestionHeader hint={hint} message={message} />
      {choices.map((choice, index) => (
        <ChoiceLine
          highlighted={index === drawn.highlighted}
          hint={choice.hint}
          key={choice.value}
          label={choice.label}
          mark={drawn.ticked[index] === true ? glyphs.ticked : glyphs.unticked}
        />
      ))}
      <Text dimColor>{`  ${legend}`}</Text>
      {drawn.error === undefined ? null : (
        <ColouredText colour="danger">{`${glyphs.failed} ${drawn.error}`}</ColouredText>
      )}
    </Box>
  )
}
