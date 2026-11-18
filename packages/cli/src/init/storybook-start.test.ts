import { describe, expect, it } from 'vitest'
import {
  type NxStartInput,
  nxProjectNameOf,
  nxStartOf,
  nxStorybookPluginTargetOf,
  portOfStart,
  type StorybookStart,
  startCommandOf,
} from './storybook-start.js'

/**
 * A `project.json` named `name`, if given, whose `storybook` target has `options`.
 */
function projectJson(options: Record<string, unknown>, name?: string): Record<string, unknown> {
  return { name, targets: { storybook: { executor: '@nx/storybook:storybook', options } } }
}

/**
 * What `nxStartOf` reads for the `.storybook` of the package `libs/ui`, which has no `package.json` and no Storybook
 * plugin, with `overrides`.
 */
function inputOf(overrides: Partial<NxStartInput>): NxStartInput {
  return {
    projectJson: undefined,
    packageName: undefined,
    hasManifest: false,
    folderName: 'ui',
    packageDir: 'libs/ui',
    configDir: 'libs/ui/.storybook',
    inferredTarget: undefined,
    ...overrides,
  }
}

describe('nxStartOf', () => {
  it('reads the project name and port of the storybook target', () => {
    expect(nxStartOf(inputOf({ projectJson: projectJson({ port: 4400 }, 'ui-lib') }))).toEqual({
      kind: 'nx',
      project: 'ui-lib',
      target: 'storybook',
      port: 4400,
    })
  })

  it("takes the package's name, then the folder name, when project.json has none", () => {
    const json = projectJson({})

    expect(nxStartOf(inputOf({ projectJson: json, packageName: '@acme/ui' }))).toMatchObject({ project: '@acme/ui' })
    expect(nxStartOf(inputOf({ projectJson: json }))).toMatchObject({ project: 'ui' })
  })

  it.each([0, 70000, 6006.5, '6006'])('has no port for %j', (port) => {
    expect(nxStartOf(inputOf({ projectJson: projectJson({ port }) }))).toMatchObject({ kind: 'nx', port: undefined })
  })

  it('serves the config folder its configDir option names, relative to the root', () => {
    const json = projectJson({ configDir: './libs/ui/docs/.storybook/' })

    expect(nxStartOf(inputOf({ projectJson: json, configDir: 'libs/ui/docs/.storybook' }))).toMatchObject({
      kind: 'nx',
    })
    expect(nxStartOf(inputOf({ projectJson: json }))).toBeUndefined()
  })

  it("serves the package's .storybook without a configDir option", () => {
    const json = projectJson({})

    expect(nxStartOf(inputOf({ projectJson: json }))).toMatchObject({ kind: 'nx' })
    expect(nxStartOf(inputOf({ projectJson: json, configDir: 'libs/ui/docs/.storybook' }))).toBeUndefined()
    expect(
      nxStartOf(inputOf({ projectJson: json, folderName: 'web', packageDir: '.', configDir: '.storybook' })),
    ).toMatchObject({ project: 'web' })
  })

  it.each([
    ['no project.json', undefined],
    ['no targets', { name: 'ui' }],
    ['no storybook target', { name: 'ui', targets: { build: {} } }],
    ['a storybook target that is not an object', { name: 'ui', targets: { storybook: 'x' } }],
  ])('gives nothing for %s without the Storybook plugin', (_, json) => {
    expect(nxStartOf(inputOf({ projectJson: json }))).toBeUndefined()
  })

  it('takes a storybook target without options', () => {
    expect(nxStartOf(inputOf({ projectJson: { targets: { storybook: {} } } }))).toEqual({
      kind: 'nx',
      project: 'ui',
      target: 'storybook',
      port: undefined,
    })
  })

  it("infers the plugin's target for a project's .storybook", () => {
    const inferred = { kind: 'nx', project: 'ui', target: 'sb', port: undefined }

    expect(nxStartOf(inputOf({ projectJson: { name: 'ui' }, inferredTarget: 'sb' }))).toEqual(inferred)
    expect(nxStartOf(inputOf({ hasManifest: true, packageName: 'ui', inferredTarget: 'sb' }))).toEqual(inferred)
  })

  it('infers no target for a folder that is no project, or another config folder', () => {
    expect(nxStartOf(inputOf({ inferredTarget: 'storybook' }))).toBeUndefined()
    expect(
      nxStartOf(inputOf({ hasManifest: true, inferredTarget: 'storybook', configDir: 'libs/ui/docs/.storybook' })),
    ).toBeUndefined()
  })

  it('takes the storybook target over the inferred one', () => {
    expect(nxStartOf(inputOf({ projectJson: projectJson({ port: 4400 }), inferredTarget: 'sb' }))).toMatchObject({
      target: 'storybook',
      port: 4400,
    })
  })
})

describe('nxProjectNameOf', () => {
  it("gives project.json's name, or undefined when it names none", () => {
    expect(nxProjectNameOf({ name: 'ui' })).toBe('ui')
    expect(nxProjectNameOf({ name: '' })).toBeUndefined()
    expect(nxProjectNameOf({})).toBeUndefined()
    expect(nxProjectNameOf(undefined)).toBeUndefined()
  })
})

describe('nxStorybookPluginTargetOf', () => {
  it.each([
    ['the plugin by name', { plugins: ['@nx/storybook/plugin'] }, 'storybook'],
    ['the plugin with no options', { plugins: [{ plugin: '@nx/storybook/plugin' }] }, 'storybook'],
    [
      'the plugin with a target name',
      { plugins: [{ plugin: '@nx/storybook/plugin', options: { serveStorybookTargetName: 'sb' } }] },
      'sb',
    ],
    ['other plugins', { plugins: ['@nx/vite/plugin', { plugin: '@nx/jest/plugin' }] }, undefined],
    ['no plugins', {}, undefined],
    ['no nx.json', undefined, undefined],
  ])('reads %s', (_, nxJson, target) => {
    expect(nxStorybookPluginTargetOf(nxJson)).toBe(target)
  })
})

describe('portOfStart', () => {
  it('gives the port of a script call or an Nx target', () => {
    const call = { script: 'sb', subcommand: 'dev' as const, configDir: undefined, port: 6007 }

    expect(portOfStart({ kind: 'script', call, packageDir: '/project' })).toBe(6007)
    expect(portOfStart({ kind: 'nx', project: 'ui', target: 'storybook', port: 4400 })).toBe(4400)
    expect(portOfStart(undefined)).toBeUndefined()
  })
})

describe('startCommandOf', () => {
  it.each<[StorybookStart, string]>([
    [
      { kind: 'script', call: { script: 'sb', subcommand: 'dev', configDir: undefined, port: 6006 }, packageDir: '/p' },
      'npm run sb',
    ],
    [{ kind: 'nx', project: 'ui', target: 'storybook', port: undefined }, 'npx nx run ui:storybook'],
    [{ kind: 'nx', project: 'ui', target: 'sb', port: undefined }, 'npx nx run ui:sb'],
  ])('words %j under npm', (start, command) => {
    expect(startCommandOf(start, 'npm')).toBe(command)
  })
})
