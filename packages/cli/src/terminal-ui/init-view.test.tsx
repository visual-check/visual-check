import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputEndedError } from '../init/prompter.js'
import type { InitResult } from '../init/run-init.js'
import { type InitView, startInitView } from './init-view.js'
import { fakeStdin, fakeStdout, keys, plainFrameOf, typeInto } from './terminal.fixture.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

/**
 * The views a test started and didn't finish, which `afterEach` finishes.
 */
const running: InitView[] = []

afterEach(async () => {
  for (const view of running.splice(0)) {
    await act(() => view.finish({ exitCode: 0, stdout: '', stderr: '' }))
  }
})

/**
 * The header, and the blank line after it, without colours.
 */
const header = '✓✓ visual-check init · v1.2.3\n\n'

/**
 * The header, and the blank line after it, in colour.
 */
const colouredHeader =
  '\u001b[38;2;0;180;216m✓\u001b[38;2;255;45;135m✓\u001b[39m \u001b[1mvisual-check\u001b[22m' +
  '\u001b[2m init · v1.2.3\u001b[22m\n\n'

/**
 * The choices of the test's select question.
 */
const managers = [
  { value: 'npm', label: 'npm' },
  { value: 'yarn', label: 'Yarn', hint: 'Yarn 1, or 2 and later' },
] as const

/**
 * Starts a view at version 1.2.3 on a fake terminal 100 columns wide, or `options.columns`, drawing every frame in
 * full. Gives the view, the terminal, and the last frame without colours.
 */
async function startView(options: { yes?: boolean; environment?: NodeJS.ProcessEnv; columns?: number } = {}) {
  const stdin = fakeStdin()
  const stdout = fakeStdout(options.columns)
  const view = await act(async () =>
    startInitView({
      version: '1.2.3',
      yes: options.yes ?? false,
      environment: options.environment ?? {},
      stdin,
      stdout,
      debug: true,
    }),
  )

  running.push(view)

  return { view, stdin, stdout, frame: () => plainFrameOf(stdout.lastFrame()) }
}

/**
 * Calls one of the view's methods that asks, and gives its answer, still to come. The answer is wrapped, since awaiting
 * this would otherwise wait for it.
 */
async function asking<T>(question: () => Promise<T>): Promise<{ answer: Promise<T> }> {
  let answer: Promise<T> | undefined

  await act(async () => {
    answer = question()
  })

  if (answer === undefined) {
    throw new Error('The question was not asked.')
  }

  return { answer }
}

/**
 * Finishes a view with a result, and takes it off the list `afterEach` finishes.
 */
async function finish(view: InitView, result: InitResult): Promise<void> {
  running.splice(running.indexOf(view), 1)
  await act(() => view.finish(result))
}

describe('startInitView', () => {
  it('draws the header and a blank line, in colour', async () => {
    const { stdout } = await startView()

    expect(stdout.lastFrame()).toBe(colouredHeader)
  })

  it('draws a note under the header', async () => {
    const { view, frame } = await startView()

    await act(async () => {
      view.note('hint: Add -p 6006 to it.')
      view.note('Found 2 Storybooks.')
    })

    expect(frame()).toBe(`${header}· Add -p 6006 to it.\nFound 2 Storybooks.\n`)
  })

  it('asks a text question with its hint, and collapses it to the answer typed', async () => {
    const { view, stdin, stdout, frame } = await startView()
    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web', hint: 'What the report calls it.' }))

    expect(frame()).toBe(`${header}? Name\n  What the report calls it.\n› web (default)`)

    await typeInto(stdin, 'd', 'o', 'c', 's', keys.enter)

    await expect(answer).resolves.toBe('docs')
    expect(stdout.lastFrame()).toBe(
      `${colouredHeader}\u001b[36m✓\u001b[39m \u001b[2mName\u001b[22m \u001b[36mdocs\u001b[39m\n`,
    )
  })

  it('shows what is wrong with an answer until the next edit', async () => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() =>
      view.text('Name', { defaultValue: 'web', validate: (value) => (value.includes(' ') ? 'No spaces.' : undefined) }),
    )

    await typeInto(stdin, 'a', ' ', 'b', keys.enter)

    expect(frame()).toBe(`${header}? Name\n› a b \n✕ No spaces.`)

    await typeInto(stdin, keys.backspace)

    expect(frame()).toBe(`${header}? Name\n› a  `)

    await typeInto(stdin, keys.backspace, keys.enter)

    await expect(answer).resolves.toBe('a')
    expect(frame()).toBe(`${header}✓ Name a\n`)
  })

  it('asks a select question, moved with ↓, and collapses it to the label of the choice', async () => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() =>
      view.select('Package manager', { choices: managers, defaultValue: 'npm', hint: 'Nothing names one.' }),
    )

    expect(frame()).toBe(`${header}? Package manager\n  Nothing names one.\n❯ npm\n  Yarn · Yarn 1, or 2 and later`)

    await typeInto(stdin, keys.down, keys.enter)

    await expect(answer).resolves.toBe('yarn')
    expect(frame()).toBe(`${header}✓ Package manager Yarn\n`)
  })

  it('asks a yes or no question, switched with →, and collapses it to yes or no', async () => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() =>
      view.confirm('Add the addon?', { defaultValue: true, hint: 'From storybook add.' }),
    )

    expect(frame()).toBe(`${header}? Add the addon?\n  From storybook add.\n› ● Yes  ○ No`)

    await typeInto(stdin, keys.right, keys.enter)

    await expect(answer).resolves.toBe(false)
    expect(frame()).toBe(`${header}✓ Add the addon? no\n`)
  })

  it('gives each question its own state, even one of the same kind drawn in the same render', async () => {
    const { view, stdin, frame } = await startView()
    const { answer: first } = await asking(() => view.text('First', { defaultValue: 'a' }))
    let second: Promise<string> | undefined

    await act(() => {
      // Ink reads each key as soon as it's told there's input, inside this act, so the answer and the next question
      // land in one render.
      for (const key of ['x', keys.enter]) {
        stdin.push(key)
        stdin.emit('readable')
      }
      second = view.text('Second', { defaultValue: 'b' })
    })

    await expect(first).resolves.toBe('x')
    expect(frame()).toBe(`${header}✓ First x\n? Second\n› b (default)`)

    await typeInto(stdin, keys.enter)

    await expect(second).resolves.toBe('b')
    expect(frame()).toBe(`${header}✓ First x\n✓ Second b\n`)
  })

  it.each([
    ['Ctrl+C', keys.ctrlC],
    ['Ctrl+D', keys.ctrlD],
  ])('rejects the question with an InputEndedError on %s, and drops it', async (_name, key) => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))
    const settled = answer.catch((error: unknown) => error)

    await typeInto(stdin, 'a', key)

    expect(await settled).toBeInstanceOf(InputEndedError)
    expect(frame()).toBe(header)
  })

  it('takes every default at once with --yes, shows each answered, and reads no input', async () => {
    const { view, stdin, frame } = await startView({ yes: true })
    const { answer: text } = await asking(() => view.text('Name', { defaultValue: 'web', validate: () => 'Never.' }))
    const { answer: select } = await asking(() =>
      view.select('Package manager', { choices: managers, defaultValue: 'yarn' }),
    )
    const { answer: confirm } = await asking(() => view.confirm('Add the addon?', { defaultValue: true }))

    await expect(text).resolves.toBe('web')
    await expect(select).resolves.toBe('yarn')
    await expect(confirm).resolves.toBe(true)
    expect(frame()).toBe(`${header}✓ Name web\n✓ Package manager Yarn\n✓ Add the addon? yes\n`)
    expect(stdin.rawModes).toEqual([])
  })

  it("shows each step's command dim, then the last five lines of its output, dim and indented", async () => {
    const { view, stdout, frame } = await startView()

    await act(async () => {
      view.progress.plan(['Write the files', 'Install'])
      view.progress.start('Write the files')
      view.progress.end('done')
      view.progress.start('Install', 'pnpm add x')
      view.progress.output('\u001b[32m1\u001b[39m\n2\n\n10%\r50%\r100%\n')
      view.progress.output('5\n6\nsev')
    })

    expect(stdout.lastFrame()).toBe(
      `${colouredHeader}\u001b[2mRunning pnpm add x\u001b[22m\n` +
        '  \u001b[2m2\u001b[22m\n  \u001b[2m100%\u001b[22m\n  \u001b[2m5\u001b[22m\n  \u001b[2m6\u001b[22m\n' +
        '  \u001b[2msev\u001b[22m',
    )

    await act(async () => {
      view.progress.end('done')
      view.progress.start('Check for unlisted dependencies')
    })

    expect(frame()).toBe(`${header}Running pnpm add x\n`)
  })

  it("cuts an output line at the terminal's edge rather than wrap it", async () => {
    const { view, frame } = await startView({ columns: 40 })

    await act(async () => {
      view.progress.start('Install', 'pnpm add x')
      view.progress.output(`${'a'.repeat(50)}\nb\n`)
    })

    expect(frame()).toBe(`${header}Running pnpm add x\n  ${'a'.repeat(37)}…\n  b`)
  })

  it('rejects a question asked while another waits, and keeps the one waiting', async () => {
    const { view, stdin, frame } = await startView()
    const { answer: first } = await asking(() => view.text('First', { defaultValue: 'a' }))
    // Caught at once, since the rejection comes before the test awaits it.
    const { answer: second } = await asking(() =>
      view.confirm('Second?', { defaultValue: true }).catch((error: unknown) => error),
    )

    expect(await second).toEqual(new Error('"Second?" can\'t be asked while "First" waits for its answer.'))
    expect(frame()).toBe(`${header}? First\n› a (default)`)

    await typeInto(stdin, keys.enter)

    await expect(first).resolves.toBe('a')
  })

  it('gives up on a question still waiting when it finishes, which rejects with an InputEndedError', async () => {
    const { view, stdout } = await startView()
    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))
    const settled = answer.catch((error: unknown) => error)

    await finish(view, { exitCode: 2, stdout: '', stderr: 'visual-check init stopped.\n' })

    expect(await settled).toBeInstanceOf(InputEndedError)
    expect(plainFrameOf(stdout.lastFrame())).toBe(`${header}✕ visual-check init stopped.\n`)
  })

  it('shows the end of the run, then stops drawing and hands the input back', async () => {
    const { view, stdin, stdout } = await startView()
    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))

    await typeInto(stdin, keys.enter)
    await answer
    await act(async () => {
      view.progress.start('Install', 'pnpm add x')
      view.progress.output('installing\n')
    })
    await finish(view, {
      exitCode: 0,
      stdout: 'Wrote visual-check.config.ts\n\nvisual-check is set up.\n',
      stderr: "Warning: Docker isn't running.\nhint: Add -p 6006.\nvisual-check init stopped.\n",
    })

    expect(stdout.lastFrame()).toBe(
      `${colouredHeader}\u001b[36m✓\u001b[39m \u001b[2mName\u001b[22m \u001b[36mweb\u001b[39m\n` +
        '\u001b[2mRunning pnpm add x\u001b[22m\n' +
        'Wrote visual-check.config.ts\n\nvisual-check is set up.\n' +
        "\u001b[33m▲\u001b[39m \u001b[33mDocker isn't running.\u001b[39m\n" +
        '\u001b[2m·\u001b[22m \u001b[2mAdd -p 6006.\u001b[22m\n' +
        '\u001b[31m✕ visual-check init stopped.\u001b[39m\n',
    )
    expect(stdin.rawModes).toEqual([true, false])
    expect(stdin.listenerCount('readable')).toBe(0)
  })

  it('draws no colour when NO_COLOR is set', async () => {
    const { view, stdout } = await startView({ yes: true, environment: { NO_COLOR: '1' } })

    await asking(() => view.text('Name', { defaultValue: 'web' }))

    expect(stdout.lastFrame()).toBe(
      '✓✓ \u001b[1mvisual-check\u001b[22m\u001b[2m init · v1.2.3\u001b[22m\n\n✓ \u001b[2mName\u001b[22m web\n',
    )
  })
})
