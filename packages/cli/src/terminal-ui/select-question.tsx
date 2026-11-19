import { Box } from 'ink'
import type { ReactNode } from 'react'
import type { Choice } from '../init/prompter.js'
import { ChoiceLine } from './choice-line.js'
import { type QuestionProps, stepOf, useLatestState, useQuestionInput } from './question.js'
import { QuestionHeader } from './question-header.js'

/**
 * What `SelectQuestion` takes. `defaultValue` is the value of the choice highlighted at the start.
 */
interface SelectQuestionProps<T extends string> extends QuestionProps<T> {
  /**
   * The answers, in the order they show. There is at least one.
   */
  choices: readonly [Choice<T>, ...Choice<T>[]]
}

/**
 * Asks the person to pick one of a list. ↑/↓ or k/j move, wrapping round at the ends, and Enter picks the highlighted
 * choice. Other keys with Ctrl or Meta do nothing.
 */
export function SelectQuestion<T extends string>({
  message,
  choices,
  defaultValue,
  hint,
  onSubmit,
  onCancel,
}: SelectQuestionProps<T>): ReactNode {
  const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue)
  const highlight = useLatestState(Math.max(defaultIndex, 0))

  useQuestionInput(onCancel, (input, key) => {
    const step = stepOf(input, key)

    if (key.return) {
      onSubmit((choices[highlight.latest()] ?? choices[0]).value)
    } else if (step !== 0) {
      highlight.set((highlight.latest() + step + choices.length) % choices.length)
    }
  })

  return (
    <Box flexDirection="column">
      <QuestionHeader hint={hint} message={message} />
      {choices.map((choice, index) => (
        <ChoiceLine
          highlighted={index === highlight.value}
          hint={choice.hint}
          key={choice.value}
          label={choice.label}
        />
      ))}
    </Box>
  )
}
