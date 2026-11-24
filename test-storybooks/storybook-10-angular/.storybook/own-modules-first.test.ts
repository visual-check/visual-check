import { describe, expect, it } from 'vitest'
import { ownModulesFirst } from './own-modules-first.ts'

describe('ownModulesFirst', () => {
  it('looks in the folder before the folders the config lists, keeping the rest of the config', () => {
    const config = { mode: 'production', resolve: { alias: { a: 'b' }, modules: ['/workspace/src', 'node_modules'] } }

    expect(ownModulesFirst(config, '/project/node_modules')).toEqual({
      mode: 'production',
      resolve: { alias: { a: 'b' }, modules: ['/project/node_modules', '/workspace/src', 'node_modules'] },
    })
  })

  it("looks in the folder, then webpack's default, when the config has no resolve options", () => {
    expect(ownModulesFirst({}, '/project/node_modules')).toEqual({
      resolve: { modules: ['/project/node_modules', 'node_modules'] },
    })
  })

  it('lists the folder once when the config already lists it', () => {
    const config = { resolve: { modules: ['node_modules', '/project/node_modules'] } }

    expect(ownModulesFirst(config, '/project/node_modules')).toEqual({
      resolve: { modules: ['/project/node_modules', 'node_modules'] },
    })
  })

  it('leaves the given config unchanged', () => {
    const config = { resolve: { modules: ['node_modules'] } }

    ownModulesFirst(config, '/project/node_modules')

    expect(config).toEqual({ resolve: { modules: ['node_modules'] } })
  })
})
