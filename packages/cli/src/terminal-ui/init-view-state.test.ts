import { describe, expect, it, vi } from 'vitest'
import type { InitResult } from '../init/run-init.js'
import {
  addNote,
  addOutput,
  askQuestion,
  createViewStore,
  endStep,
  finishRun,
  initialViewState,
  type NewQuestion,
  planSteps,
  settleQuestion,
  showQuestionProgress,
  startStep,
} from './init-view-state.js'
import { emptyOutputTail } from './output-tail.js'

/**
 * The state of a view at version 1.2.3 that has shown nothing but its header.
 */
const initial = initialViewState('1.2.3')

/**
 * A text question with callbacks that do nothing.
 */
function textQuestion(message: string): NewQuestion {
  return {
    kind: 'text',
    message,
    defaultValue: 'web',
    hint: undefined,
    validate: undefined,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  }
}

describe('initialViewState', () => {
  it('starts with the header, keyed 0, and nothing else', () => {
    expect(initial).toEqual({
      lines: [{ id: 0, kind: 'header', version: '1.2.3' }],
      question: undefined,
      questionProgress: undefined,
      steps: [],
      plannedAt: undefined,
      nextId: 1,
    })
  })
})

describe('showQuestionProgress', () => {
  it('keeps how many questions are answered of the total, and nothing else changes', () => {
    expect(showQuestionProgress(initial, 2, 9)).toEqual({ ...initial, questionProgress: { answered: 2, total: 9 } })
  })
})

describe('addNote', () => {
  it('adds the note with the next key', () => {
    const state = addNote(addNote(initial, 'hint: one'), 'Warning: two')

    expect(state.lines.slice(1)).toEqual([
      { id: 1, kind: 'note', text: 'hint: one' },
      { id: 2, kind: 'note', text: 'Warning: two' },
    ])
    expect(state.nextId).toBe(3)
  })

  it('leaves the state it was given alone', () => {
    addNote(initial, 'hint: one')

    expect(initial.lines).toHaveLength(1)
  })
})

describe('askQuestion', () => {
  it('makes the question wait for its answer, with the next key', () => {
    const question = textQuestion('Name')
    const state = askQuestion(addNote(initial, 'hint: one'), question)

    expect(state.question).toEqual({ ...question, id: 2 })
    expect(state.nextId).toBe(3)
  })

  it('makes a checklist question wait with its choices and validation', () => {
    const question: NewQuestion = {
      kind: 'checklist',
      message: 'Storybooks',
      defaultValue: ['web'],
      hint: undefined,
      choices: [{ value: 'web', label: 'web' }],
      validate: () => 'Never.',
      onSubmit: () => undefined,
      onCancel: () => undefined,
    }
    const state = askQuestion(initial, question)

    expect(state.question).toEqual({ ...question, id: 1 })
    expect(state.nextId).toBe(2)
  })

  it('throws while another question waits', () => {
    const state = askQuestion(initial, textQuestion('Name'))

    expect(() => askQuestion(state, textQuestion('URL'))).toThrow(
      new Error('"URL" can\'t be asked while "Name" waits for its answer.'),
    )
  })
})

describe('settleQuestion', () => {
  it('puts the answered line in place of the question', () => {
    const state = settleQuestion(askQuestion(initial, textQuestion('Name')), {
      kind: 'answered',
      message: 'Name',
      answer: 'docs',
    })

    expect(state.question).toBeUndefined()
    expect(state.lines.slice(1)).toEqual([{ id: 2, kind: 'answered', message: 'Name', answer: 'docs' }])
    expect(state.nextId).toBe(3)
  })

  it('drops a question given up on, and shows nothing in its place', () => {
    const asked = askQuestion(initial, textQuestion('Name'))
    const state = settleQuestion(asked)

    expect(state).toEqual({ ...asked, question: undefined })
  })

  it('shows an answer taken without asking, as --yes does', () => {
    const state = settleQuestion(initial, { kind: 'answered', message: 'Name', answer: 'web' })

    expect(state.lines.slice(1)).toEqual([{ id: 1, kind: 'answered', message: 'Name', answer: 'web' }])
  })
})

describe('planSteps', () => {
  it('lists each step pending, with the next keys, and keeps when the plan was given', () => {
    const state = planSteps(addNote(initial, 'one'), ['Write', 'Install'], 1000)

    expect(state.steps).toEqual([
      { id: 2, title: 'Write', state: 'pending', output: emptyOutputTail },
      { id: 3, title: 'Install', state: 'pending', output: emptyOutputTail },
    ])
    expect(state.plannedAt).toBe(1000)
    expect(state.nextId).toBe(4)
  })
})

describe('startStep', () => {
  /**
   * Two steps planned at 1000.
   */
  const planned = planSteps(initial, ['Write', 'Install'], 1000)

  it('starts the first pending step, with its command and when it started', () => {
    const state = startStep(
      endStep(startStep(planned, 'Write', undefined, 1000), 'done', 1200),
      'Install',
      'pnpm add x',
      1300,
    )

    expect(state.steps).toEqual([
      { id: 1, title: 'Write', state: 'done', output: emptyOutputTail, startedAt: 1000, endedAt: 1200 },
      { id: 2, title: 'Install', state: 'running', output: emptyOutputTail, command: 'pnpm add x', startedAt: 1300 },
    ])
  })

  it('goes by position, and takes the title it is given', () => {
    expect(startStep(planned, 'Write the files', undefined, 1000).steps[0]).toEqual({
      id: 1,
      title: 'Write the files',
      state: 'running',
      output: emptyOutputTail,
      startedAt: 1000,
    })
  })

  it('changes nothing without a plan, or once every step has started', () => {
    const started = startStep(startStep(planned, 'Write', undefined, 1000), 'Install', undefined, 1000)

    expect(startStep(initial, 'Write', undefined, 1000)).toBe(initial)
    expect(startStep(started, 'More', undefined, 1000)).toBe(started)
  })
})

describe('addOutput', () => {
  it("adds a chunk to the running step's output", () => {
    const running = startStep(planSteps(initial, ['Install'], 1000), 'Install', 'pnpm add x', 1000)
    const state = addOutput(addOutput(running, 'one\ntw'), 'o\n')

    expect(state.steps[0]?.output).toEqual({ lines: ['one', 'two'], unfinished: '' })
  })

  it('changes nothing with no step running', () => {
    const planned = planSteps(initial, ['Install'], 1000)

    expect(addOutput(planned, 'one\n')).toBe(planned)
    expect(addOutput(initial, 'one\n')).toBe(initial)
  })
})

describe('endStep', () => {
  it.each(['done', 'warned', 'failed'] as const)('ends the running step %s, with when it ended', (outcome) => {
    const running = addOutput(startStep(planSteps(initial, ['Install'], 1000), 'Install', 'pnpm add x', 1000), 'a\n')

    expect(endStep(running, outcome, 2500).steps).toEqual([
      {
        id: 1,
        title: 'Install',
        state: outcome,
        output: { lines: ['a'], unfinished: '' },
        command: 'pnpm add x',
        startedAt: 1000,
        endedAt: 2500,
      },
    ])
  })

  it('changes nothing with no step running', () => {
    const planned = planSteps(initial, ['Install'], 1000)

    expect(endStep(planned, 'done', 1000)).toBe(planned)
    expect(endStep(initial, 'failed', 1000)).toBe(initial)
  })
})

describe('finishRun', () => {
  /**
   * The result of a run that stopped before it wrote.
   */
  const stopped: InitResult = {
    exitCode: 2,
    stdout: '',
    stderr: 'hint: a\nStopped.\n',
    messages: ['hint: a', 'Stopped.'],
  }

  it('shows the result, and drops the question', () => {
    const state = finishRun(askQuestion(initial, textQuestion('Name')), stopped)

    expect(state).toEqual({
      lines: [...initial.lines, { id: 2, kind: 'summary', result: stopped }],
      question: undefined,
      steps: [],
      plannedAt: undefined,
      nextId: 3,
    })
  })

  it('shows the steps that never started after a failed one as skipped', () => {
    const planned = planSteps(initial, ['Write', 'Install', 'Check'], 1000)
    const failed = endStep(startStep(planned, 'Write', undefined, 1000), 'failed', 1500)
    const [line] = finishRun(failed, stopped).lines.slice(1)

    expect(line).toEqual({
      id: 4,
      kind: 'steps',
      steps: [
        { id: 1, title: 'Write', state: 'failed', output: emptyOutputTail, startedAt: 1000, endedAt: 1500 },
        { id: 2, title: 'Install', state: 'skipped', output: emptyOutputTail },
        { id: 3, title: 'Check', state: 'skipped', output: emptyOutputTail },
      ],
      startedAt: 1000,
    })
  })

  it('leaves the steps that never started pending when none failed', () => {
    const planned = planSteps(initial, ['Write', 'Install'], 1000)
    const [line] = finishRun(planned, stopped).lines.slice(1)

    expect(line).toEqual({ id: 3, kind: 'steps', steps: planned.steps, startedAt: 1000 })
  })

  it('moves the steps, as they ended, into the lines before the result', () => {
    const ended = endStep(
      startStep(planSteps(initial, ['Write', 'Install'], 1000), 'Write', undefined, 1000),
      'done',
      1500,
    )
    const state = finishRun(ended, stopped)

    expect(state).toEqual({
      lines: [
        ...initial.lines,
        { id: 3, kind: 'steps', steps: ended.steps, startedAt: 1000 },
        { id: 4, kind: 'summary', result: stopped },
      ],
      question: undefined,
      steps: [],
      plannedAt: undefined,
      nextId: 5,
    })
  })
})

describe('createViewStore', () => {
  it('gives the state as the last update left it, and tells each listener until it unsubscribes', () => {
    const store = createViewStore(initial)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.update((state) => addNote(state, 'one'))
    unsubscribe()
    store.update((state) => addNote(state, 'two'))

    expect(listener).toHaveBeenCalledOnce()
    expect(store.get().lines.map((line) => ('text' in line ? line.text : line.kind))).toEqual(['header', 'one', 'two'])
  })

  it('keeps the state, and tells no listener, when an update throws', () => {
    const store = createViewStore(askQuestion(initial, textQuestion('Name')))
    const listener = vi.fn()
    const before = store.get()

    store.subscribe(listener)

    expect(() => store.update((state) => askQuestion(state, textQuestion('URL')))).toThrow()
    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })
})
