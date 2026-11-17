import { Box, Static, Text } from 'ink'
import { type ReactNode, useSyncExternalStore } from 'react'
import { AnsweredLine } from './answered-line.js'
import { BrandHeader } from './brand-header.js'
import { ColouredText } from './coloured-text.js'
import { ConfirmQuestion } from './confirm-question.js'
import type { ActiveQuestion, ShownLine, ViewStore } from './init-view-state.js'
import { NoteLine } from './note-line.js'
import { shownLinesOf } from './output-tail.js'
import { SelectQuestion } from './select-question.js'
import { TextQuestion } from './text-question.js'
import { glyphs } from './theme.js'

/**
 * What `StaticLine` takes.
 */
interface StaticLineProps {
  /**
   * The line to draw.
   */
  line: ShownLine
}

/**
 * What `QuestionView` takes.
 */
interface QuestionViewProps {
  /**
   * The question waiting for its answer.
   */
  question: ActiveQuestion
}

/**
 * What `InitScreen` takes.
 */
interface InitScreenProps {
  /**
   * Holds what to draw.
   */
  store: ViewStore
}

/**
 * Draws one line that never changes again.
 */
function StaticLine({ line }: StaticLineProps): ReactNode {
  switch (line.kind) {
    case 'header':
      return (
        <Box marginBottom={1}>
          <BrandHeader command="init" version={line.version} />
        </Box>
      )
    case 'note':
      return <NoteLine text={line.text} />
    case 'answered':
      return <AnsweredLine answer={line.answer} message={line.message} />
    case 'command':
      return <Text dimColor>{`Running ${line.command}`}</Text>
    case 'printed':
      return <Text>{line.text}</Text>
    case 'failed':
      return <ColouredText colour="danger">{`${glyphs.failed} ${line.text}`}</ColouredText>
  }
}

/**
 * Draws the question waiting for its answer.
 */
function QuestionView({ question }: QuestionViewProps): ReactNode {
  const { message, hint, onCancel } = question

  switch (question.kind) {
    case 'text':
      return (
        <TextQuestion
          defaultValue={question.defaultValue}
          hint={hint}
          message={message}
          onCancel={onCancel}
          onSubmit={question.onSubmit}
          validate={question.validate}
        />
      )
    case 'confirm':
      return (
        <ConfirmQuestion
          defaultValue={question.defaultValue}
          hint={hint}
          message={message}
          onCancel={onCancel}
          onSubmit={question.onSubmit}
        />
      )
    case 'select':
      return (
        <SelectQuestion
          choices={question.choices}
          defaultValue={question.defaultValue}
          hint={hint}
          message={message}
          onCancel={onCancel}
          onSubmit={question.onSubmit}
        />
      )
  }
}

/**
 * Draws the init view: the lines that never change again, then the question waiting for its answer, then the end of
 * the running command's output, dim and indented. Each output line is cut at the terminal's edge rather than wrapped,
 * so the output keeps its height while it changes.
 */
export function InitScreen({ store }: InitScreenProps): ReactNode {
  const { lines, question, output } = useSyncExternalStore(store.subscribe, store.get)
  const outputLines = shownLinesOf(output)

  return (
    <>
      <Static items={lines}>{(line) => <StaticLine key={line.id} line={line} />}</Static>
      {question === undefined ? null : <QuestionView key={question.id} question={question} />}
      {outputLines.length === 0 ? null : (
        <Box marginLeft={2}>
          {/* Ink cuts each line of the text on its own. */}
          <Text dimColor wrap="truncate-end">
            {outputLines.join('\n')}
          </Text>
        </Box>
      )}
    </>
  )
}
