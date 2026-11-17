import { describe, expect, it } from 'vitest'
import { ContainerError, DockerMissingError } from '../container/container-error.js'
import { projectOf, storybookOf } from './detected-project.fixture.js'
import { blockingProblemsOf, dockerWarningOf, versionNotesOf } from './init-checks.js'

/**
 * The arguments of `blockingProblemsOf` for a setup with nothing wrong.
 */
const fine = { cwd: '/project', nodeVersion: '22.23.1', project: projectOf(), yes: false, interactive: true }

describe('blockingProblemsOf', () => {
  it('finds nothing wrong with a fine setup', () => {
    expect(blockingProblemsOf(fine)).toEqual([])
  })

  it.each([
    ['20.18.0', true],
    ['22.0.0', false],
  ])('judges Node %s', (nodeVersion, blocked) => {
    expect(blockingProblemsOf({ ...fine, nodeVersion })).toEqual(
      blocked
        ? [
            `visual-check needs Node 22 or later, and this is Node ${nodeVersion}. Upgrade Node, then run visual-check init again.`,
          ]
        : [],
    )
  })

  it('stops at no package.json, after the Node problem', () => {
    const noManifest =
      "visual-check init found no package.json in the current folder or its parents. Run it in your project's folder."

    expect(blockingProblemsOf({ ...fine, project: undefined, interactive: false })).toEqual([noManifest])
    expect(blockingProblemsOf({ ...fine, project: undefined, nodeVersion: '20.18.0' })).toEqual([
      'visual-check needs Node 22 or later, and this is Node 20.18.0. Upgrade Node, then run visual-check init again.',
      noManifest,
    ])
  })

  it("names a package.json it can't read, relative to the folder it runs in", () => {
    const project = projectOf({ manifestProblem: 'the file must hold a JSON object' })

    expect(blockingProblemsOf({ ...fine, project })).toEqual([
      "visual-check init can't read package.json: the file must hold a JSON object. Fix it, then run visual-check init again.",
    ])
    expect(blockingProblemsOf({ ...fine, cwd: '/project/docs', project })).toEqual([
      "visual-check init can't read ../package.json: the file must hold a JSON object. Fix it, then run visual-check init again.",
    ])
  })

  it('refuses a Deno project', () => {
    const project = projectOf({ denoFile: 'deno.json' })

    expect(blockingProblemsOf({ ...fine, project })).toEqual([
      "visual-check doesn't support Deno, and this project has deno.json. Run visual-check init in a Node project.",
    ])
  })

  it('refuses to ask questions without a terminal, unless --yes', () => {
    expect(blockingProblemsOf({ ...fine, interactive: false })).toEqual([
      "visual-check init asks questions, and there's no terminal to ask them in. Run it in a terminal, or pass --yes to take every default.",
    ])
    expect(blockingProblemsOf({ ...fine, interactive: false, yes: true })).toEqual([])
  })

  it('finds no Storybook', () => {
    expect(blockingProblemsOf({ ...fine, project: projectOf({ storybooks: [] }) })).toEqual([
      'visual-check init found no Storybook: git lists no .storybook/main file (.ts, .js, .mjs, .cjs, .mts or .cts), and no script in package.json passes -c to storybook. Add Storybook, then run visual-check init again.',
    ])
  })

  it('names each Storybook below the minimum version', () => {
    const project = projectOf({
      storybooks: [storybookOf({ version: '9.0.0' }), storybookOf({ configDir: 'docs/.storybook', version: '8.6.0' })],
    })

    expect(blockingProblemsOf({ ...fine, project })).toEqual([
      'The Storybook in .storybook runs storybook 9.0.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.',
      'The Storybook in docs/.storybook runs storybook 8.6.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.',
    ])
  })

  it('lists every problem, in order', () => {
    const base = { cwd: '/project', nodeVersion: '20.0.0', yes: false, interactive: false }
    const project = projectOf({
      manifestProblem: 'nope',
      denoFile: 'deno.lock',
      storybooks: [storybookOf({ version: '9.0.0' })],
    })
    const common = [
      'visual-check needs Node 22 or later, and this is Node 20.0.0. Upgrade Node, then run visual-check init again.',
      "visual-check init can't read package.json: nope. Fix it, then run visual-check init again.",
      "visual-check doesn't support Deno, and this project has deno.lock. Run visual-check init in a Node project.",
      "visual-check init asks questions, and there's no terminal to ask them in. Run it in a terminal, or pass --yes to take every default.",
    ]

    expect(blockingProblemsOf({ ...base, project })).toEqual([
      ...common,
      'The Storybook in .storybook runs storybook 9.0.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.',
    ])
    expect(blockingProblemsOf({ ...base, project: { ...project, storybooks: [] } })).toEqual([
      ...common,
      'visual-check init found no Storybook: git lists no .storybook/main file (.ts, .js, .mjs, .cjs, .mts or .cts), and no script in package.json passes -c to storybook. Add Storybook, then run visual-check init again.',
    ])
  })

  it.each(['9.1.0', '10.6.7', '11.0.0-alpha.1', '12.0.0', undefined])('lets version %s through', (version) => {
    const project = projectOf({ storybooks: [storybookOf({ version })] })

    expect(blockingProblemsOf({ ...fine, project })).toEqual([])
  })
})

describe('versionNotesOf', () => {
  it.each(['9.1.0', '10.6.7', '11.0.0-alpha.1', '9.0.0'])('says nothing of %s', (version) => {
    expect(versionNotesOf(projectOf({ storybooks: [storybookOf({ version })] }))).toEqual([])
  })

  it('warns of a version above the tested ones', () => {
    expect(versionNotesOf(projectOf({ storybooks: [storybookOf({ version: '12.0.0' })] }))).toEqual([
      'Warning: .storybook runs storybook 12.0.0, newer than the versions visual-check is tested on (9.1 to 11).',
    ])
  })

  it('hints at installing dependencies when storybook is missing', () => {
    expect(versionNotesOf(projectOf({ storybooks: [storybookOf({ version: undefined })] }))).toEqual([
      "hint: storybook isn't installed for .storybook, so init skips its addon. Install dependencies, then run init again.",
    ])
  })
})

describe('dockerWarningOf', () => {
  /**
   * The sentence a missing or stopped Docker gets after its message.
   */
  const dockerFix = "Start or install Docker before you run visual-check update, or set platform: 'host' in the config."

  it('tells to install a missing Docker', () => {
    const error = new DockerMissingError("there's no docker command on PATH.")

    expect(dockerWarningOf(error, 'linux')).toBe(`Warning: ${error.message} ${dockerFix}`)
  })

  it('adds the WSL sentence on Windows for a missing Docker', () => {
    const error = new DockerMissingError("there's no docker command on PATH.")

    expect(dockerWarningOf(error, 'win32')).toBe(
      `Warning: ${error.message} ${dockerFix} If Docker runs inside WSL, run visual-check from inside WSL too.`,
    )
  })

  it('leaves the WSL sentence out for a stopped Docker', () => {
    const error = new ContainerError("Docker's daemon isn't running.", 'docker')

    expect(dockerWarningOf(error, 'win32')).toBe(`Warning: ${error.message} ${dockerFix}`)
  })

  it('gives only the message for the other container errors', () => {
    expect(dockerWarningOf(new ContainerError('Windows containers.', 'linux-containers'), 'win32')).toBe(
      'Warning: Windows containers.',
    )
    expect(dockerWarningOf(new ContainerError('Untested runtime.', 'tested-runtimes'), 'linux')).toBe(
      'Warning: Untested runtime.',
    )
  })

  it('rethrows anything else', () => {
    const error = new Error('boom')

    expect(() => dockerWarningOf(error, 'linux')).toThrow(error)
  })
})
