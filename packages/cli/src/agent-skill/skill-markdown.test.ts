import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { skillMarkdownOf, skillSourcePaths, skillVersionOf } from './skill-markdown.js'

/**
 * The package's `SKILL.md` template, as it ships.
 */
const template = readFileSync(skillSourcePaths.markdown, 'utf8')

/**
 * The template's frontmatter, split into top-level fields and the fields under `metadata`.
 */
const frontmatter = (() => {
  const lines = template.split('\n')
  const end = lines.indexOf('---', 1)
  const fields = new Map<string, string>()
  const metadata = new Map<string, string>()

  for (const line of lines.slice(1, end)) {
    const nested = /^ {2}([a-z-]+):\s*(.*)$/.exec(line)
    const topLevel = /^([a-z-]+):\s*(.*)$/.exec(line)

    if (nested) {
      metadata.set(nested[1] ?? '', nested[2] ?? '')
    } else if (topLevel) {
      fields.set(topLevel[1] ?? '', topLevel[2] ?? '')
    }
  }

  return { fields, metadata, body: lines.slice(end + 1).join('\n') }
})()

describe('the SKILL.md template', () => {
  it('holds only the Agent Skills fields and the version', () => {
    expect([...frontmatter.fields.keys()]).toEqual(['name', 'description', 'compatibility', 'metadata'])
    expect([...frontmatter.metadata.keys()]).toEqual(['visual-check-version'])
  })

  it('has a valid name, description and compatibility', () => {
    const name = frontmatter.fields.get('name') ?? ''
    const description = frontmatter.fields.get('description') ?? ''
    const compatibility = frontmatter.fields.get('compatibility') ?? ''

    expect(name).toBe('visual-check')
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(description.length).toBeGreaterThanOrEqual(1)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(compatibility.length).toBeGreaterThanOrEqual(1)
    expect(compatibility.length).toBeLessThanOrEqual(500)

    for (const value of [description, compatibility]) {
      expect(value).not.toContain(': ')
      expect(value).not.toContain(' #')
    }
  })

  it.each([
    'After changing UI code or stories, before saying the work is done.',
    'When asked whether a change alters how stories look.',
    'node .agents/skills/visual-check/scripts/run.mjs test',
    'only when the user asks for it',
    'Never run it to make a failure pass.',
    '`reportDir` joined with `images.diff`',
    'Never open a snapshot, a baseline or a visual diff.',
    'Always for broken stories.',
    "Never suggest `platform: 'host'`.",
    '`MemoryRouter` with `useTransitions={false}`',
    'serve the image from Storybook, then mock it with MSW, then mask it by host',
    'Propose each fix with its snippet, and apply it only once the user agrees.',
    "Never raise tolerance, disable a story, set `allowOverflow` or run `update` to make a failure pass without the user's explicit OK.",
    'only when the user says the cut is intended, `allowOverflow: true`',
    'allowOverflow: true,',
    'One with `severity: "fail"` makes `test` exit 1 even when every snapshot passed.',
    'an `expectedPageErrors` entry on that story',
    "`null` for the default capture, which a story with `defaultCapture: false` doesn't have",
    "Never set `pageErrors` to `'warn'` or `'off'`, or declare an expected page error the story doesn't raise on purpose, to make a failure pass without the user's explicit OK.",
    'for each entry with a non-empty `realRequests`',
    "Never set `realRequests` to `'warn'` or `'off'`, or add a host to `silenceHosts`, to make a failure pass without the user's explicit OK.",
  ])('tells the agent: %s', (text) => {
    expect(frontmatter.body).toContain(text)
  })

  it('offers allowOverflow for overflows only after fixing the layout and the viewport or element', () => {
    const positions = [
      '`overflows`',
      'first the layout',
      'a wider `viewport`',
      'an element that holds the content',
    ].map((text) => frontmatter.body.indexOf(text))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(frontmatter.body.indexOf('`allowOverflow: true`.')).toBeGreaterThan(positions[3] ?? Number.POSITIVE_INFINITY)
  })

  it('lists the fixes in order', () => {
    const positions = [
      '1. **Exit 2:**',
      '2. **A broken story',
      '3. **A page error',
      '4. **A real network request',
      '5. **The remote-content hint',
      '6. **A flaky snapshot',
    ].map((text) => frontmatter.body.indexOf(text))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it("names platform: 'host' only to say never to suggest it", () => {
    expect(template.split("platform: 'host'")).toHaveLength(2)
  })
})

describe('skillMarkdownOf', () => {
  it('sets the version and changes nothing else', () => {
    const markdown = skillMarkdownOf(template, '1.2.3')
    const templateLines = template.split('\n')
    const changed = markdown.split('\n').filter((line, index) => line !== templateLines[index])

    expect(skillVersionOf(markdown)).toBe('1.2.3')
    expect(markdown.split('\n')).toHaveLength(templateLines.length)
    expect(changed).toEqual(['  visual-check-version: "1.2.3"'])
  })

  it('throws on a template with no version line', () => {
    expect(() => skillMarkdownOf('---\nname: visual-check\n---\n', '1.2.3')).toThrow(/visual-check-version/)
  })
})

describe('skillVersionOf', () => {
  it.each([
    ['double quotes', '"1.2.3"'],
    ['single quotes', "'1.2.3'"],
    ['no quotes', '1.2.3'],
  ])('reads a version in %s', (_, value) => {
    expect(skillVersionOf(`---\nname: visual-check\nmetadata:\n  visual-check-version: ${value}\n---\n# Body\n`)).toBe(
      '1.2.3',
    )
  })

  it('reads CRLF text', () => {
    expect(skillVersionOf('---\r\nmetadata:\r\n  visual-check-version: "1.2.3"\r\n---\r\n# Body\r\n')).toBe('1.2.3')
  })

  it('gives undefined with no frontmatter', () => {
    expect(skillVersionOf('# visual-check\n\n  visual-check-version: "1.2.3"\n')).toBeUndefined()
  })

  it('gives undefined with an empty version', () => {
    expect(skillVersionOf('---\nmetadata:\n  visual-check-version: ""\n---\n# Body\n')).toBeUndefined()
  })

  it('gives undefined with no version line', () => {
    expect(skillVersionOf('---\nname: visual-check\n---\n# Body\n')).toBeUndefined()
  })

  it('gives undefined when the version line is outside the frontmatter', () => {
    expect(skillVersionOf('---\nname: visual-check\n---\n\n  visual-check-version: "1.2.3"\n')).toBeUndefined()
  })
})
