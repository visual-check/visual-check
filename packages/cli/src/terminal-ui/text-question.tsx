import { Box, Text, usePaste } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { type QuestionProps, useLatestState, useQuestionInput } from './question.js'
import { QuestionHeader } from './question-header.js'
import { emptyTextInput, type TextInputEdit, textAnswerOf, textInputEditOf, textInputReducer } from './text-input.js'
import { glyphs } from './theme.js'

/**
 * What `TextQuestion` takes. An empty input answers with `defaultValue`.
 */
interface TextQuestionProps extends QuestionProps<string> {
  /**
   * Returns what is wrong with an answer, or `undefined` when it is fine. A wrong answer stays to be edited.
   */
  validate?: ((value: string) => string | undefined) | undefined
}

/**
 * What `InputLine` takes.
 */
interface InputLineProps {
  /**
   * What the person typed so far.
   */
  value: string
  /**
   * Where the next character goes, in characters from the start of `value`.
   */
  cursor: number
  /**
   * The answer an empty input gives.
   */
  defaultValue: string
}

/**
 * The line the person types on: `›`, then the input with the cursor as an inverse cell. While the input is empty, it
 * shows the default and the word `(default)`, both dim, so the words say it is the default where the terminal draws
 * no styles.
 */
function InputLine({ value, cursor, defaultValue }: InputLineProps): ReactNode {
  const characters = [...(value === '' ? defaultValue : value)]
  const before = characters.slice(0, cursor).join('')
  const atCursor = characters[cursor] ?? ' '
  const after = characters.slice(cursor + 1).join('')

  return (
    <Text>
      <ColouredText colour="accent">{glyphs.pointer}</ColouredText>{' '}
      {value === '' ? (
        <Text dimColor>
          <Text inverse>{atCursor}</Text>
          {after}
          {defaultValue === '' ? '' : ' (default)'}
        </Text>
      ) : (
        <Text>
          {before}
          <Text inverse>{atCursor}</Text>
          {after}
        </Text>
      )}
    </Text>
  )
}

/**
 * Asks for a line of text. It takes typed and pasted text at the cursor, ←/→ to move, Backspace and Delete to erase,
 * Ctrl+U or Esc to clear, Tab to edit the default, and Enter to answer with the input trimmed, or the default.
 */
export function TextQuestion({
  message,
  defaultValue,
  hint,
  onSubmit,
  onCancel,
  validate,
}: TextQuestionProps): ReactNode {
  const input = useLatestState(emptyTextInput)
  const drawn = input.value

  /**
   * Applies an edit to the input as the key handler last left it.
   */
  function apply(edit: TextInputEdit): void {
    input.set(textInputReducer(input.latest(), edit))
  }

  /**
   * Answers with the input trimmed, or the default, unless `validate` finds it wrong.
   */
  function submit(): void {
    const answer = textAnswerOf(input.latest().value, defaultValue)
    const problem = validate?.(answer)

    if (problem === undefined) {
      onSubmit(answer)
    } else {
      apply({ type: 'reject', message: problem })
    }
  }

  useQuestionInput(
    onCancel,
    (typed, key) => {
      const edit = textInputEditOf(typed, key, defaultValue)

      if (key.return) {
        submit()
      } else if (edit !== undefined) {
        apply(edit)
      }
    },
    { modifiedKeys: true },
  )

  usePaste((text) => {
    apply({ type: 'insert', text })
  })

  return (
    <Box flexDirection="column">
      <QuestionHeader hint={hint} message={message} />
      <InputLine cursor={drawn.cursor} defaultValue={defaultValue} value={drawn.value} />
      {drawn.error === undefined ? null : (
        <ColouredText colour="danger">{`${glyphs.failed} ${drawn.error}`}</ColouredText>
      )}
    </Box>
  )
}
