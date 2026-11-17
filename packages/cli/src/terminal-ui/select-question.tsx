import { Box, type Key, Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { type QuestionProps, useLatestState, useQuestionInput } from './question.js'
import { QuestionHeader } from './question-header.js'
import { glyphs } from './theme.js'

/**
 * One answer a select question offers.
 */
interface Choice<T extends string> {
  /**
   * What the question answers with when this choice is picked.
   */
  value: T
  /**
   * What the person sees.
   */
  label: string
  /**
   * A few words after the label that help pick it.
   */
  hint?: string | undefined
}

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
 * What `ChoiceLine` takes.
 */
interface ChoiceLineProps {
  /**
   * What the person sees.
   */
  label: string
  /**
   * Whether the choice is the highlighted one.
   */
  highlighted: boolean
  /**
   * A few words after the label that help pick it.
   */
  hint?: string | undefined
}

/**
 * One choice: `❯` and the label in the accent colour when highlighted, the label indented to match when not, then the
 * hint dim.
 */
function ChoiceLine({ label, highlighted, hint }: ChoiceLineProps): ReactNode {
  return (
    <Text>
      {highlighted ? <ColouredText colour="accent">{`${glyphs.selected} ${label}`}</ColouredText> : `  ${label}`}
      {hint === undefined ? null : <Text dimColor>{` ${glyphs.hint} ${hint}`}</Text>}
    </Text>
  )
}

/**
 * How far a key press moves the highlight: back one for ↑ or k, on one for ↓ or j, and nowhere for any other key.
 */
function stepOf(input: string, key: Key): number {
  if (key.upArrow || input === 'k') {
    return -1
  }

  if (key.downArrow || input === 'j') {
    return 1
  }

  return 0
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
