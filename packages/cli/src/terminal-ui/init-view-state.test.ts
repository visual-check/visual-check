import { describe, expect, it, vi } from 'vitest'
import {
  addNote,
  addOutput,
  askQuestion,
  createViewStore,
  finishRun,
  initialViewState,
  type NewQuestion,
  resultLinesOf,
  settleQuestion,
  startStep,
  type ViewState,
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
      output: emptyOutputTail,
      nextId: 1,
    })
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

describe('startStep and addOutput', () => {
  it("shows a step's command, then the end of its output", () => {
    const state = addOutput(addOutput(startStep(initial, 'pnpm add x'), 'one\ntw'), 'o\n')

    expect(state.lines.slice(1)).toEqual([{ id: 1, kind: 'command', command: 'pnpm add x' }])
    expect(state.output).toEqual({ lines: ['one', 'two'], unfinished: '' })
  })

  it('drops the output of the step before, and shows nothing for a step without a command', () => {
    const before = addOutput(startStep(initial, 'pnpm add x'), 'one\n')
    const state = startStep(before, undefined)

    expect(state).toEqual({ ...before, output: emptyOutputTail })
  })
})

describe('finishRun', () => {
  it('shows the result, and drops the question and the output', () => {
    const before: ViewState = addOutput(askQuestion(initial, textQuestion('Name')), 'one\n')
    const state = finishRun(before, { exitCode: 2, stdout: '', stderr: 'hint: a\nStopped.\n' })

    expect(state).toEqual({
      lines: [...initial.lines, { id: 2, kind: 'note', text: 'hint: a' }, { id: 3, kind: 'failed', text: 'Stopped.' }],
      question: undefined,
      output: emptyOutputTail,
      nextId: 4,
    })
  })
})

describe('resultLinesOf', () => {
  it('gives the stdout as one printed line, its blank lines kept and its last line break dropped', () => {
    expect(resultLinesOf({ exitCode: 0, stdout: 'Wrote a\n\nDone.\n', stderr: '' })).toEqual([
      { kind: 'printed', text: 'Wrote a\n\nDone.' },
    ])
  })

  it('gives each stderr line as a note when it is a warning or a hint, else as a failure', () => {
    expect(resultLinesOf({ exitCode: 2, stdout: '', stderr: 'Warning: a\nhint: b\nwarning: c\nd' })).toEqual([
      { kind: 'note', text: 'Warning: a' },
      { kind: 'note', text: 'hint: b' },
      { kind: 'failed', text: 'warning: c' },
      { kind: 'failed', text: 'd' },
    ])
  })

  it('gives nothing for a result with no text', () => {
    expect(resultLinesOf({ exitCode: 0, stdout: '', stderr: '' })).toEqual([])
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
