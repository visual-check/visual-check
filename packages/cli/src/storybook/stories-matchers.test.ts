import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStoriesMatchers } from './stories-matchers.js'
import { makeStorybookFolder, removeStorybookFolders } from './storybook-package.fixture.js'

vi.setConfig({ testTimeout: 30_000 })

afterEach(() => {
  removeStorybookFolders()
})

/**
 * A `main.mjs` whose `stories` are the given entries.
 */
function mainWithStories(entries: readonly string[]): string {
  return `export default { stories: ${JSON.stringify(entries)} }\n`
}

/**
 * A `main.*` that prints the lines itself and exits with 0 before the loader gets to print its result.
 */
function exitingAfter(lines: string): string {
  return `process.stdout.write('\\n${lines}\\n', () => process.exit(0))\nawait new Promise(() => undefined)\n`
}

/**
 * Gives the sources of the matchers, or `undefined` when there are none.
 */
function sourcesOf(matchers: readonly RegExp[] | undefined): string[] | undefined {
  return matchers?.map((matcher) => matcher.source)
}

describe('readStoriesMatchers', () => {
  it("gives the matchers of Storybook 9's CommonJS build, given noCache", async () => {
    const storybook = makeStorybookFolder({ flavour: '9', main: mainWithStories(['^a', '^b']) })

    expect(sourcesOf(await readStoriesMatchers(storybook))).toEqual(['^a', '^b'])
  })

  it("gives the matchers of Storybook 10's ESM build, given skipCache", async () => {
    const storybook = makeStorybookFolder({ flavour: '10', main: mainWithStories(['^a']) })

    expect(sourcesOf(await readStoriesMatchers(storybook))).toEqual(['^a'])
  })

  it('reads each Storybook with its own storybook package', async () => {
    const first = makeStorybookFolder({ flavour: '9', tag: 'first', main: mainWithStories(['a']) })
    const second = makeStorybookFolder({ flavour: '10', tag: 'second', main: mainWithStories(['a']) })

    const [firstMatchers, secondMatchers] = await Promise.all([readStoriesMatchers(first), readStoriesMatchers(second)])

    expect(sourcesOf(firstMatchers)).toEqual(['firsta'])
    expect(sourcesOf(secondMatchers)).toEqual(['seconda'])
  })

  it('still reads the result when main.* logs before it', async () => {
    const storybook = makeStorybookFolder({
      flavour: '10',
      main: `console.log('loading')\nconsole.log('["not", "it"]')\n${mainWithStories(['^a'])}`,
    })

    expect(sourcesOf(await readStoriesMatchers(storybook))).toEqual(['^a'])
  })

  it('gives undefined when no storybook package resolves', async () => {
    const storybook = makeStorybookFolder({ main: mainWithStories(['a']) })

    expect(await readStoriesMatchers(storybook)).toBeUndefined()
  })

  it('gives undefined when main.* throws', async () => {
    const storybook = makeStorybookFolder({ flavour: '10', main: "throw new Error('broken')\n" })

    expect(await readStoriesMatchers(storybook)).toBeUndefined()
  })

  it('gives undefined when stories is a function', async () => {
    const storybook = makeStorybookFolder({ flavour: '10', main: 'export default { stories: () => [] }\n' })

    expect(await readStoriesMatchers(storybook)).toBeUndefined()
  })

  it('gives undefined when main.* prints junk last and exits on its own', async () => {
    const storybook = makeStorybookFolder({ flavour: '10', main: exitingAfter('[["a", ""]]\\njunk') })

    expect(await readStoriesMatchers(storybook)).toBeUndefined()
  })

  it("gives undefined when a matcher isn't a valid regular expression", async () => {
    const storybook = makeStorybookFolder({ flavour: '10', main: exitingAfter('[["(", ""]]') })

    expect(await readStoriesMatchers(storybook)).toBeUndefined()
  })

  it('gives the matchers at once when main.* leaves a timer running', async () => {
    const storybook = makeStorybookFolder({
      flavour: '10',
      main: `setInterval(() => undefined, 60_000)\n${mainWithStories(['^a'])}`,
    })
    const start = Date.now()

    expect(sourcesOf(await readStoriesMatchers(storybook, { timeoutMs: 10_000 }))).toEqual(['^a'])
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('gives undefined, without waiting longer, when the Storybook never finishes loading', async () => {
    const storybook = makeStorybookFolder({
      flavour: '10',
      main: 'setInterval(() => undefined, 1000)\nawait new Promise(() => undefined)\n',
    })
    const start = Date.now()

    expect(await readStoriesMatchers(storybook, { timeoutMs: 200 })).toBeUndefined()
    expect(Date.now() - start).toBeLessThan(5000)
  })
})

describe("with the test Storybooks' Storybook 9.1, 10 and 11", () => {
  /**
   * The folder of a test Storybook in this repo.
   */
  function testStorybookOf(name: string): { dir: string; configDir: string } {
    const dir = fileURLToPath(new URL(`../../../../test-storybooks/${name}`, import.meta.url))

    return { dir, configDir: join(dir, '.storybook') }
  }

  it.each([
    ['storybook-9-react', '../storybook-10-react/stories/card.stories.tsx'],
    ['storybook-10-react', './stories/card.stories.tsx'],
    ['storybook-11-react', '../storybook-10-react/stories/card.stories.tsx'],
  ])('%s matches its stories files and nothing else', async (name, storiesFile) => {
    const matchers = await readStoriesMatchers(testStorybookOf(name))

    expect(matchers).toBeDefined()
    expect(matchers?.some((matcher) => matcher.test(storiesFile))).toBe(true)
    expect(matchers?.some((matcher) => matcher.test('./stories/card.tsx'))).toBe(false)
  })
})
