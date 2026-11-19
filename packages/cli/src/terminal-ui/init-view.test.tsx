import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pnpmAdd, toolsOf } from '../init/init-tools.fixture.js'
import { pnpmProject, removeProjects } from '../init/project.fixture.js'
import { InputEndedError, type Prompter } from '../init/prompter.js'
import { type InitResult, type InitTools, runInit } from '../init/run-init.js'
import { type InitView, startInitView } from './init-view.js'
import { advanceTimers, fakeStdin, fakeStdout, keys, plainFrameOf, typeInto } from './terminal.fixture.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

/**
 * The views a test started and didn't finish, which `afterEach` finishes.
 */
const running: InitView[] = []

beforeEach(() => {
  // Only the spinner's and the step list's timers are faked: React and Ink keep their real ones to draw.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(async () => {
  for (const view of running.splice(0)) {
    await act(() => view.finish({ exitCode: 0, stdout: '', stderr: '', messages: [] }))
  }

  vi.useRealTimers()
  removeProjects()
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
 * How a test starts a view.
 */
interface ViewSetup {
  /**
   * Whether `--yes` was passed.
   */
  yes?: boolean
  /**
   * The environment.
   */
  environment?: NodeJS.ProcessEnv
  /**
   * How wide the terminal is: 100 columns when not given.
   */
  columns?: number
  /**
   * Tells the time: always 1,000 ms when not given.
   */
  clock?: () => number
}

/**
 * Starts a view at version 1.2.3 on a fake terminal, drawing every frame in full. Gives the view, the terminal, and the
 * last frame without colours.
 */
async function startView(options: ViewSetup = {}) {
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
      clock: options.clock ?? (() => 1000),
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

/**
 * Lets a test wait, inside `act`, until the run stops to wait on the person or on a command.
 */
function waitPoints() {
  let reach: (() => void) | undefined

  return {
    /**
     * Resolves the next time the run stops.
     */
    next(): Promise<void> {
      return new Promise((resolve) => {
        reach = resolve
      })
    },
    /**
     * Tells the test the run stopped on `waiting`, and gives it back.
     */
    reached<T>(waiting: T): T {
      reach?.()
      reach = undefined

      return waiting
    },
  }
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

  it('answers with the text and the Enter typed in one chunk', async () => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))

    await typeInto(stdin, 'docs\r')

    await expect(answer).resolves.toBe('docs')
    expect(frame()).toBe(`${header}✓ Name docs\n`)
  })

  it('answers once for two Enters in one chunk, and the next question still waits', async () => {
    const { view, stdin, frame } = await startView()
    const { answer: first } = await asking(() => view.text('First', { defaultValue: 'a' }))

    await typeInto(stdin, '\r\r')

    await expect(first).resolves.toBe('a')
    expect(frame()).toBe(`${header}✓ First a\n`)

    const { answer: second } = await asking(() => view.text('Second', { defaultValue: 'b' }))

    expect(frame()).toBe(`${header}✓ First a\n? Second\n› b (default)`)

    await typeInto(stdin, keys.enter)

    await expect(second).resolves.toBe('b')
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

  it('asks a checklist question, toggled with Space, and collapses it to the labels ticked', async () => {
    const { view, stdin, frame } = await startView()
    const validate = vi.fn((values: string[]) => (values.length === 0 ? 'Pick one.' : undefined))
    const { answer } = await asking(() =>
      view.checklist('Package managers', {
        choices: managers,
        defaultValues: [],
        hint: 'Nothing names one.',
        validate,
      }),
    )

    expect(frame()).toBe(
      `${header}? Package managers\n  Nothing names one.\n❯ ◯ npm\n  ◯ Yarn · Yarn 1, or 2 and later\n  <space> to tick, 'a' for all, <enter> to confirm`,
    )

    await typeInto(stdin, keys.enter, 'a', keys.enter)

    await expect(answer).resolves.toEqual(['npm', 'yarn'])
    expect(validate).toHaveBeenNthCalledWith(1, [])
    expect(validate).toHaveBeenNthCalledWith(2, ['npm', 'yarn'])
    expect(frame()).toBe(`${header}✓ Package managers npm, Yarn\n`)
  })

  it('collapses a checklist with nothing ticked to none', async () => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() => view.checklist('Addon', { choices: managers, defaultValues: [] }))

    await typeInto(stdin, keys.enter)

    await expect(answer).resolves.toEqual([])
    expect(frame()).toBe(`${header}✓ Addon none\n`)
  })

  it('rejects a checklist with an InputEndedError on Ctrl+C', async () => {
    const { view, stdin, frame } = await startView()
    const { answer } = await asking(() => view.checklist('Addon', { choices: managers, defaultValues: [] }))
    const settled = answer.catch((error: unknown) => error)

    await typeInto(stdin, keys.ctrlC)

    expect(await settled).toBeInstanceOf(InputEndedError)
    expect(frame()).toBe(header)
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

  it('shows how far through the questions the person is above the one waiting, and nothing once none waits', async () => {
    const { view, stdin, stdout, frame } = await startView()

    await act(async () => {
      view.questionProgress(2, 4)
    })

    expect(frame()).toBe(header)

    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))

    expect(frame()).toBe(`${header}━━━━━━━━━━────────── Step 3 of 4\n? Name\n› web (default)`)
    expect(stdout.lastFrame()).toContain('\u001b[36m━━━━━━━━━━\u001b[39m\u001b[2m──────────\u001b[22m Step 3 of 4\n')

    await typeInto(stdin, keys.enter)

    await expect(answer).resolves.toBe('web')
    expect(frame()).toBe(`${header}✓ Name web\n`)
  })

  it('never counts past the total, and narrows the bar so the label fits a narrow terminal', async () => {
    const { view, stdin, frame } = await startView({ columns: 25 })

    await act(async () => {
      view.questionProgress(4, 4)
    })

    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))

    // The header wraps at 25 columns too, so only the question area is compared.
    expect(frame().endsWith('\n━━━━━━━━━━━━━ Step 4 of 4\n? Name\n› web (default)')).toBe(true)

    await typeInto(stdin, keys.enter)

    await expect(answer).resolves.toBe('web')
  })

  it('takes every default at once with --yes, shows each answered, and reads no input', async () => {
    const { view, stdin, frame } = await startView({ yes: true })

    await act(async () => {
      view.questionProgress(0, 4)
    })

    const { answer: text } = await asking(() => view.text('Name', { defaultValue: 'web', validate: () => 'Never.' }))
    const { answer: select } = await asking(() =>
      view.select('Package manager', { choices: managers, defaultValue: 'yarn' }),
    )
    const { answer: confirm } = await asking(() => view.confirm('Add the addon?', { defaultValue: true }))
    const { answer: checklist } = await asking(() =>
      view.checklist('Storybooks', { choices: managers, defaultValues: ['yarn'], validate: () => 'Never.' }),
    )

    await expect(checklist).resolves.toEqual(['yarn'])
    await expect(text).resolves.toBe('web')
    await expect(select).resolves.toBe('yarn')
    await expect(confirm).resolves.toBe(true)
    expect(frame()).toBe(`${header}✓ Name web\n✓ Package manager Yarn\n✓ Add the addon? yes\n✓ Storybooks Yarn\n`)
    expect(stdin.rawModes).toEqual([])
  })

  it('shows the steps once planned, the running one with its command and the last three lines of its output', async () => {
    let now = 1000
    const { view, stdout, frame } = await startView({ clock: () => now })

    await act(async () => {
      view.progress.plan(['Write the files', 'Install', 'Check'])
    })

    expect(frame()).toBe(`${header}\n──────────────────── 0/3 · 0.0s\n○ Write the files\n○ Install\n○ Check`)

    await act(async () => {
      view.progress.start('Write the files')
      now = 1400
      view.progress.end('done')
      view.progress.start('Install', 'pnpm add x')
      view.progress.output('\u001b[32m1\u001b[39m\n2\n\n10%\r50%\r100%\n')
      view.progress.output('5\nsev')
    })

    expect(stdout.lastFrame()).toBe(
      `${colouredHeader}\n\u001b[36m━━━━━━━\u001b[39m\u001b[2m─────────────\u001b[22m 1/3\u001b[2m · 0.4s\u001b[22m\n` +
        '\u001b[36m✓\u001b[39m \u001b[36mWrite the files\u001b[39m\u001b[2m 0.4s\u001b[22m\n' +
        '\u001b[38;2;0;180;216m⠋\u001b[39m Install\u001b[2m 0.0s\u001b[22m\n' +
        '  \u001b[2mpnpm add x\u001b[22m\n' +
        '  \u001b[2m│ 100%\u001b[22m\n  \u001b[2m│ 5\u001b[22m\n  \u001b[2m│ sev\u001b[22m\n' +
        '\u001b[2m○\u001b[22m \u001b[2mCheck\u001b[22m',
    )

    now = 3400
    await advanceTimers(1000)

    expect(frame()).toBe(
      `${header}\n━━━━━━━───────────── 1/3 · 2.4s\n✓ Write the files 0.4s\n⠹ Install 2.0s\n  pnpm add x\n` +
        '  │ 100%\n  │ 5\n  │ sev\n○ Check',
    )

    await act(async () => {
      view.progress.end('failed')
    })

    expect(frame()).toBe(
      `${header}\n━━━━━━━━━━━━━─────── 2/3 · 2.4s\n✓ Write the files 0.4s\n✕ Install 2.0s\n` +
        '  │ 1\n  │ 2\n  │ 100%\n  │ 5\n  │ sev\n○ Check',
    )
  })

  it('shows no steps until they are planned', async () => {
    const { view, frame } = await startView()

    await act(async () => {
      view.progress.start('Install', 'pnpm add x')
      view.progress.output('one\n')
      view.progress.end('done')
    })

    expect(frame()).toBe(header)
  })

  it('prints the steps as they ended, the ones after a failure skipped, then the summary, once each', async () => {
    const { view, stdout } = await startView()

    await act(async () => {
      view.progress.plan(['Write the files', 'Install', 'Check'])
      view.progress.start('Write the files')
      view.progress.end('done')
      view.progress.start('Install', 'pnpm add x')
      view.progress.output('ERR_PNPM_FETCH_404\n')
      view.progress.end('failed')
    })
    await finish(view, {
      exitCode: 2,
      stdout: 'Replaced the script visual:check in package.json.\n',
      stderr: 'pnpm add x failed with exit code 1.\n',
      messages: ['pnpm add x failed with exit code 1.'],
      summary: { replacedLine: 'Replaced the script visual:check in package.json.' },
    })

    expect(plainFrameOf(stdout.lastFrame())).toBe(
      `${header}\n━━━━━━━━━━━━━─────── 2/3 · 0.0s\n✓ Write the files 0.0s\n✕ Install 0.0s\n  │ ERR_PNPM_FETCH_404\n` +
        '− Check skipped\n\n  Replaced the script visual:check in package.json.\n✕ pnpm add x failed with exit code 1.\n',
    )
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

    await finish(view, {
      exitCode: 2,
      stdout: '',
      stderr: 'visual-check init stopped.\n',
      messages: ['visual-check init stopped.'],
    })

    expect(await settled).toBeInstanceOf(InputEndedError)
    expect(plainFrameOf(stdout.lastFrame())).toBe(`${header}✕ visual-check init stopped.\n`)
  })

  it('shows why the run stopped, then stops drawing and hands the input back', async () => {
    const { view, stdin, stdout } = await startView()
    const { answer } = await asking(() => view.text('Name', { defaultValue: 'web' }))

    await typeInto(stdin, keys.enter)
    await answer
    await finish(view, {
      exitCode: 2,
      stdout: '',
      stderr: "Warning: Docker isn't running.\nhint: Add -p 6006.\nvisual-check init stopped.\n",
      messages: ["Warning: Docker isn't running.", 'hint: Add -p 6006.', 'visual-check init stopped.'],
    })

    expect(stdout.lastFrame()).toBe(
      `${colouredHeader}\u001b[36m✓\u001b[39m \u001b[2mName\u001b[22m \u001b[36mweb\u001b[39m\n` +
        "\u001b[33m▲\u001b[39m \u001b[33mDocker isn't running.\u001b[39m\n" +
        '\u001b[2m·\u001b[22m \u001b[2mAdd -p 6006.\u001b[22m\n' +
        '\u001b[31m✕\u001b[39m \u001b[31mvisual-check init stopped.\u001b[39m\n',
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

  it('drives a whole run: the questions, the steps as they run, then the steps as they ended and the summary', async () => {
    let now = 1000
    const root = pnpmProject()
    const { view, stdin, frame } = await startView({ columns: 160, clock: () => now })
    const stops = waitPoints()
    let finishInstall: (exitCode: number) => void = () => undefined
    const prompter: Prompter = {
      text: (message, options) => stops.reached(view.text(message, options)),
      confirm: (message, options) => stops.reached(view.confirm(message, options)),
      select: (message, options) => stops.reached(view.select(message, options)),
      checklist: (message, options) => stops.reached(view.checklist(message, options)),
      note: (text) => view.note(text),
      questionProgress: (answered, total) => view.questionProgress(answered, total),
    }
    const runCommand: InitTools['runCommand'] = (_command, args) => {
      if (!args.includes('--save-exact')) {
        return Promise.resolve(0)
      }

      view.progress.output('Lockfile is up to date\nPackages: +3\n+++\nProgress: resolved 3, reused 3, downloaded 0')

      return stops.reached(
        new Promise((resolve) => {
          finishInstall = resolve
        }),
      )
    }
    const { tools } = toolsOf({ yes: false, interactive: true, prompter, progress: view.progress, runCommand })

    /**
     * Does what answers a question, then waits until the run stops again.
     */
    async function until(action: () => void): Promise<void> {
      await act(async () => {
        const stop = stops.next()

        action()
        await stop
      })
    }

    const firstQuestion = stops.next()
    // The run reaches the view only after it has read the project, by then inside the act below.
    const run = runInit(root, tools)

    await act(() => firstQuestion)

    expect(frame()).toBe(
      `${header}──────────────────── Step 1 of 5\n` +
        '? Name of the Storybook in .storybook\n  What the config and the report call this Storybook.\n› web-app (default)',
    )

    for (let answered = 0; answered < 5; answered += 1) {
      await until(() => stdin.push(keys.enter))
    }

    const answers =
      '✓ Name of the Storybook in .storybook web-app\n' +
      '✓ URL of web-app http://127.0.0.1:6006\n' +
      '✓ Name of the script that runs visual-check test visual:check\n' +
      '✓ Name of the script that runs visual-check update visual:update\n' +
      '✓ Add the Storybook addon to web-app? yes\n'
    const installTitle = "Install visual-check's packages"

    now = 3500
    await advanceTimers(1000)

    expect(frame()).toBe(
      `${header}${answers}\n━━━━──────────────── 1/5 · 2.5s\n` +
        '✓ Write the files and scripts 0.0s\n' +
        `⠹ ${installTitle} 2.5s\n` +
        `  ${pnpmAdd.command} ${pnpmAdd.args.join(' ')}\n` +
        '  │ Packages: +3\n  │ +++\n  │ Progress: resolved 3, reused 3, downloaded 0\n' +
        '○ Install the browser package\n' +
        '○ Add the Storybook addon to web-app\n' +
        '○ Check for unlisted dependencies',
    )

    await act(async () => {
      now = 6000
      finishInstall(0)
      await run
    })

    const steps =
      '\n━━━━━━━━━━━━━━━━━━━━ 5/5 · 5.0s\n' +
      '✓ Write the files and scripts 0.0s\n' +
      `✓ ${installTitle} 5.0s\n` +
      '✓ Install the browser package 0.0s\n' +
      '✓ Add the Storybook addon to web-app 0.0s\n' +
      '✓ Check for unlisted dependencies 0.0s'

    expect(frame()).toBe(`${header}${answers}${steps}`)

    await finish(view, await run)

    expect(frame()).toBe(`${header}${answers}${steps}

✓ visual-check is set up

Next
  1  pnpm run storybook       Start Storybook, and keep it running
  2  pnpm run visual:update   Write the first baselines
  3  pnpm run visual:check    Check the stories against the baselines
  4  Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })
})
