import { describe, expect, it } from 'vitest'
import { repoRoot } from '../workspace/manifests.ts'
import {
  type FallowBoundaries,
  findSourceLayoutProblems,
  readFallowBoundaries,
  readSourceFiles,
  type SourceFile,
} from './source-layout.ts'

/**
 * Joins snippet pieces into one string, so this file never contains the forbidden text it feeds to the check.
 */
const glue = (...pieces: string[]) => pieces.join('')

/**
 * Builds a source file at the given repo-relative path with the given content.
 */
const file = (path: string, content = ''): SourceFile => ({ path, content })

/**
 * The boundaries of a clean layout: one module in one package, with its zone and its rule.
 */
const cleanBoundaries: FallowBoundaries = {
  zones: [{ name: 'cli/commands', patterns: ['packages/cli/src/commands/**'] }],
  rules: [{ from: 'cli/commands', allow: [] }],
}

/**
 * The files of a clean layout: an entry and one file in the module.
 */
const cleanFiles: SourceFile[] = [
  file('packages/cli/src/bin.ts'),
  file('packages/cli/src/commands/run-cli.ts', "import { x } from './x.ts'\nexport const y = x\n"),
]

describe('findSourceLayoutProblems', () => {
  it('returns no problems for a clean layout', () => {
    expect(findSourceLayoutProblems(cleanFiles, cleanBoundaries)).toEqual([])
  })

  it('accepts a nested zone for a submodule', () => {
    const files = [...cleanFiles, file('packages/cli/src/capture/driver/cdp.ts')]
    const boundaries: FallowBoundaries = {
      zones: [
        ...cleanBoundaries.zones,
        { name: 'cli/capture', patterns: ['packages/cli/src/capture/**'] },
        { name: 'cli/capture/driver', patterns: ['packages/cli/src/capture/driver/**'] },
      ],
      rules: [...cleanBoundaries.rules, { from: 'cli/capture', allow: [] }, { from: 'cli/capture/driver', allow: [] }],
    }

    expect(findSourceLayoutProblems(files, boundaries)).toEqual([])
  })

  describe('module without a zone', () => {
    it('names the folder and the zone to add', () => {
      const files = [...cleanFiles, file('packages/cli/src/config/load.ts')]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([
        'packages/cli/src/config/ is a module with no zone: add zone "cli/config" with pattern "packages/cli/src/config/**" to .fallowrc.json boundaries',
      ])
    })
  })

  describe('malformed zone', () => {
    it('rejects a pattern that swallows other modules', () => {
      const boundaries: FallowBoundaries = {
        zones: [{ name: 'cli/commands', patterns: ['packages/cli/src/**'] }],
        rules: cleanBoundaries.rules,
      }

      expect(findSourceLayoutProblems(cleanFiles, boundaries)).toEqual([
        'Zone "cli/commands" must have exactly the pattern ["packages/cli/src/commands/**"], found ["packages/cli/src/**"]',
      ])
    })

    it('rejects a zone with more than one pattern', () => {
      const boundaries: FallowBoundaries = {
        zones: [{ name: 'cli/commands', patterns: ['packages/cli/src/commands/**', 'packages/cli/src/bin.ts'] }],
        rules: cleanBoundaries.rules,
      }

      expect(findSourceLayoutProblems(cleanFiles, boundaries)).toHaveLength(1)
    })

    it('rejects a name that is not <package>/<path>', () => {
      const boundaries: FallowBoundaries = {
        zones: [...cleanBoundaries.zones, { name: 'commands', patterns: ['packages/cli/src/commands/**'] }],
        rules: [...cleanBoundaries.rules, { from: 'commands', allow: [] }],
      }

      expect(findSourceLayoutProblems(cleanFiles, boundaries)).toEqual([
        'Zone "commands" must be named "<package>/<path>", for example "cli/commands"',
      ])
    })

    it('reports a stale zone whose folder has no files', () => {
      const boundaries: FallowBoundaries = {
        zones: [...cleanBoundaries.zones, { name: 'cli/gone', patterns: ['packages/cli/src/gone/**'] }],
        rules: [...cleanBoundaries.rules, { from: 'cli/gone', allow: [] }],
      }

      expect(findSourceLayoutProblems(cleanFiles, boundaries)).toEqual([
        'Zone "cli/gone" is stale: packages/cli/src/gone/ has no files, remove the zone and its rule',
      ])
    })
  })

  describe('zone without a rule', () => {
    it('names the zone and the rule to add', () => {
      const boundaries: FallowBoundaries = { zones: cleanBoundaries.zones, rules: [] }

      expect(findSourceLayoutProblems(cleanFiles, boundaries)).toEqual([
        'Zone "cli/commands" has no rule: add { "from": "cli/commands", "allow": [...] } to .fallowrc.json boundaries.rules, an unruled zone may import anything',
      ])
    })
  })

  describe('re-export', () => {
    const forms: [string, string][] = [
      ['a named re-export', glue('export { a } ', "from './a.ts'")],
      ['a type-only named re-export', glue('export type { A } ', "from './a.ts'")],
      ['a star re-export', glue('export * ', "from './a.ts'")],
      ['a type-only star re-export', glue('export type * ', "from './a.ts'")],
      ['a namespace re-export', glue('export * as a ', "from './a.ts'")],
      ['a type-only namespace re-export', glue('export type * as a ', "from './a.ts'")],
      ['a multi-line re-export', glue('export {\n  a,\n  b,\n} ', 'from "./a.ts"')],
      ['a default re-export', glue('export { default } ', "from './a.ts'")],
    ]

    it.each(forms)('flags %s', (_description, content) => {
      const files = [...cleanFiles, file('packages/cli/src/commands/barrel.ts', content)]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([
        'packages/cli/src/commands/barrel.ts re-exports from another file: import what you publish, then export it, and import symbols from the file that defines them',
      ])
    })

    it('flags a re-export in a package entry too', () => {
      const files = [...cleanFiles, file('packages/cli/src/index.ts', glue('export { a } ', "from './commands/a.ts'"))]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toHaveLength(1)
    })

    it('allows importing then exporting', () => {
      const content = "import { a } from './a.ts'\nexport { a }\nexport const b = 1\nexport type { A }\n"
      const files = [...cleanFiles, file('packages/cli/src/index.ts', content)]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([])
    })
  })

  describe('suppression comment', () => {
    const suppressions: [string, string][] = [
      ['a Biome private-imports ignore', glue('// biome', '-ignore lint/correctness/noPrivateImports: x')],
      ['a Biome barrel-file ignore', glue('// biome', '-ignore lint/performance/noBarrelFile: x')],
      ['a Biome re-export-all ignore', glue('// biome', '-ignore lint/performance/noReExportAll: x')],
      ['a Biome block-statements ignore', glue('// biome', '-ignore lint/style/useBlockStatements: x')],
      ['a Biome ignore-all', glue('// biome', '-ignore-all lint/correctness/noPrivateImports: x')],
      ['a Biome ignore-start', glue('// biome', '-ignore-start lint/correctness/noPrivateImports: x')],
      ['a Biome ignore in a block comment', glue('/* biome', '-ignore lint/correctness/noPrivateImports: x */')],
      ['a Fallow boundary ignore for the file', glue('// fallow', '-ignore-file boundary-violation')],
      ['a Fallow boundary ignore for a line', glue('// fallow', '-ignore-next-line boundary-violation')],
      ['a Fallow coverage ignore', glue('// fallow', '-ignore-file boundary-coverage')],
      ['a Fallow call ignore', glue('// fallow', '-ignore-file boundary-call-violation')],
      ['a Fallow cycle ignore', glue('// fallow', '-ignore-next-line circular-dependency')],
      ['a Fallow ignore of everything', glue('// fallow', '-ignore-file')],
    ]

    it.each(suppressions)('flags %s', (_description, content) => {
      const files = [...cleanFiles, file('packages/cli/src/commands/sneaky.ts', `${content}\nexport const a = 1\n`)]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([
        'packages/cli/src/commands/sneaky.ts suppresses a layout rule with a comment: remove it and fix the import or the layout instead',
      ])
    })

    it('allows a suppression of an unrelated rule', () => {
      const content = `${glue('// biome', '-ignore lint/suspicious/noExplicitAny: x')}\nexport const a = 1\n`
      const files = [...cleanFiles, file('packages/cli/src/commands/other.ts', content)]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([])
    })

    it('allows a Fallow ignore of an unrelated issue', () => {
      const content = `${glue('// fallow', '-ignore-next-line unused-export')}\nexport const a = 1\n`
      const files = [...cleanFiles, file('packages/cli/src/commands/other.ts', content)]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([])
    })
  })

  describe('catch-all folder', () => {
    const names = [
      'utils',
      'util',
      'helpers',
      'helper',
      'common',
      'shared',
      'lib',
      'types',
      'services',
      'models',
      'misc',
    ]

    it.each(names)('flags a folder named %s inside a module', (name) => {
      const files = [...cleanFiles, file(`packages/cli/src/commands/${name}/x.ts`)]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([
        `packages/cli/src/commands/${name}/ is a catch-all folder: name it for what it does in the domain, or move its files into the module that owns them`,
      ])
    })

    it('flags a top-level catch-all folder once, however many files it holds', () => {
      const boundaries: FallowBoundaries = {
        zones: [...cleanBoundaries.zones, { name: 'cli/utils', patterns: ['packages/cli/src/utils/**'] }],
        rules: [...cleanBoundaries.rules, { from: 'cli/utils', allow: [] }],
      }
      const files = [...cleanFiles, file('packages/cli/src/utils/a.ts'), file('packages/cli/src/utils/b.ts')]

      expect(findSourceLayoutProblems(files, boundaries)).toEqual([
        'packages/cli/src/utils/ is a catch-all folder: name it for what it does in the domain, or move its files into the module that owns them',
      ])
    })

    it('allows a file named like a catch-all folder', () => {
      const files = [...cleanFiles, file('packages/cli/src/commands/utils.ts')]

      expect(findSourceLayoutProblems(files, cleanBoundaries)).toEqual([])
    })
  })
})

describe('real workspace', () => {
  it('reads source files from every package', () => {
    const paths = readSourceFiles(repoRoot).map((sourceFile) => sourceFile.path)

    expect(paths).toContain('packages/repo-checks/src/source-layout/source-layout.ts')
    expect(paths).toContain('packages/cli/src/commands/run-cli.ts')
    expect(paths.every((path) => !path.includes('\\'))).toBe(true)
  })

  it('reads the Fallow boundaries', () => {
    const boundaries = readFallowBoundaries(repoRoot)

    expect(boundaries.zones.map((zone) => zone.name)).toContain('repo-checks/source-layout')
    expect(boundaries.rules.map((rule) => rule.from)).toContain('repo-checks/source-layout')
  })

  it('finds no source layout problems', () => {
    expect(findSourceLayoutProblems(readSourceFiles(repoRoot), readFallowBoundaries(repoRoot))).toEqual([])
  })
})
