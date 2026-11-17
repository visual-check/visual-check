import { Box, type Key, Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { type QuestionProps, useLatestState, useQuestionInput } from './question.js'
import { QuestionHeader } from './question-header.js'
import { glyphs } from './theme.js'

/**
 * What `ConfirmChoice` takes.
 */
interface ConfirmChoiceProps {
  /**
   * Whether this side is the one chosen.
   */
  chosen: boolean
  /**
   * The side's word.
   */
  label: string
}

/**
 * One side of a yes or no question: `●` and the word bold in the accent colour when chosen, `○` and the word dim when
 * not. The glyph shows the choice where the terminal draws no styles.
 */
function ConfirmChoice({ chosen, label }: ConfirmChoiceProps): ReactNode {
  if (chosen) {
    return (
      <ColouredText bold colour="accent">
        {`${glyphs.chosen} ${label}`}
      </ColouredText>
    )
  }

  return <Text dimColor>{`${glyphs.unchosen} ${label}`}</Text>
}

/**
 * Whether a key press switches to the other side: ←, →, h, l or Tab.
 */
function isToggleKey(input: string, key: Key): boolean {
  return key.leftArrow || key.rightArrow || key.tab || input === 'h' || input === 'l'
}

/**
 * Asks a yes or no question. ←/→, h/l or Tab switch sides, Enter answers with the chosen side, and y or n answer
 * straight away. Other keys with Ctrl or Meta do nothing.
 */
export function ConfirmQuestion({
  message,
  defaultValue,
  hint,
  onSubmit,
  onCancel,
}: QuestionProps<boolean>): ReactNode {
  const answer = useLatestState(defaultValue)

  useQuestionInput(onCancel, (input, key) => {
    const letter = input.toLowerCase()

    if (key.return) {
      onSubmit(answer.latest())
    } else if (letter === 'y' || letter === 'n') {
      answer.set(letter === 'y')
      onSubmit(letter === 'y')
    } else if (isToggleKey(input, key)) {
      answer.set(!answer.latest())
    }
  })

  return (
    <Box flexDirection="column">
      <QuestionHeader hint={hint} message={message} />
      <Text>
        <ColouredText colour="accent">{glyphs.pointer}</ColouredText>{' '}
        <ConfirmChoice chosen={answer.value} label="Yes" />
        {'  '}
        <ConfirmChoice chosen={!answer.value} label="No" />
      </Text>
    </Box>
  )
}
