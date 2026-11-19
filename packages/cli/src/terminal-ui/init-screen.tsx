import { Box, Static, useWindowSize } from 'ink'
import { type ReactNode, useSyncExternalStore } from 'react'
import { AnsweredLine } from './answered-line.js'
import { BrandHeader } from './brand-header.js'
import { ChecklistQuestion } from './checklist-question.js'
import { ConfirmQuestion } from './confirm-question.js'
import type { ActiveQuestion, QuestionProgress, ShownLine, ViewStore } from './init-view-state.js'
import { NoteLine } from './message-line.js'
import { ProgressBar } from './progress-bar.js'
import { SelectQuestion } from './select-question.js'
import { StepList } from './step-list.js'
import { Summary } from './summary.js'
import { TextQuestion } from './text-question.js'

/**
 * What `StaticLine` takes.
 */
interface StaticLineProps {
  /**
   * The line to draw.
   */
  line: ShownLine
  /**
   * Tells the time now, in milliseconds since the epoch.
   */
  clock: () => number
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
 * What `QuestionArea` takes.
 */
interface QuestionAreaProps {
  /**
   * The question waiting for its answer.
   */
  question: ActiveQuestion
  /**
   * How far through the questions the person is, when known.
   */
  progress: QuestionProgress | undefined
}

/**
 * What `InitScreen` takes.
 */
interface InitScreenProps {
  /**
   * Holds what to draw.
   */
  store: ViewStore
  /**
   * Tells the time now, in milliseconds since the epoch, which the steps' durations count with.
   */
  clock: () => number
}

/**
 * Draws one line that never changes again.
 */
function StaticLine({ line, clock }: StaticLineProps): ReactNode {
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
    case 'steps':
      return <StepList clock={clock} startedAt={line.startedAt} steps={line.steps} />
    case 'summary':
      return <Summary result={line.result} />
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
    case 'checklist':
      return (
        <ChecklistQuestion
          choices={question.choices}
          defaultValue={question.defaultValue}
          hint={hint}
          message={message}
          onCancel={onCancel}
          onSubmit={question.onSubmit}
          validate={question.validate}
        />
      )
  }
}

/**
 * How many cells wide the questions' bar is at most, as wide as the setup steps' bar.
 */
const questionBarWidth = 20

/**
 * Draws the question waiting for its answer, with a bar of how far through the questions the person is above it, such
 * as `Question 3 of 9`, once known. The count never goes past the total. In a narrow terminal the bar narrows, so the
 * label always fits on its line.
 */
function QuestionArea({ question, progress }: QuestionAreaProps): ReactNode {
  const { columns } = useWindowSize()

  if (progress === undefined) {
    return <QuestionView key={question.id} question={question} />
  }

  const { answered, total } = progress
  const label = `Question ${Math.min(answered + 1, total)} of ${total}`

  return (
    <Box flexDirection="column">
      <ProgressBar
        done={answered}
        label={label}
        total={total}
        width={Math.max(0, Math.min(questionBarWidth, columns - label.length - 1))}
      />
      <QuestionView key={question.id} question={question} />
    </Box>
  )
}

/**
 * Draws the init view: the lines that never change again, then the question waiting for its answer under how far
 * through the questions the person is, then the setup steps once they are planned. Once the run is finished, the
 * steps as they ended and its summary are among the lines.
 */
export function InitScreen({ store, clock }: InitScreenProps): ReactNode {
  const { lines, question, questionProgress, steps, plannedAt } = useSyncExternalStore(store.subscribe, store.get)

  return (
    <>
      <Static items={lines}>{(line) => <StaticLine clock={clock} key={line.id} line={line} />}</Static>
      {question === undefined ? null : <QuestionArea progress={questionProgress} question={question} />}
      {plannedAt === undefined ? null : <StepList clock={clock} startedAt={plannedAt} steps={steps} />}
    </>
  )
}
