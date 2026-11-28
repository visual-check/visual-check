import { describe, expect, it } from 'vitest'
import { networkWarningsOf, warningsTextOf } from './network-warning.js'

/**
 * Builds the hosts one captured snapshot reached.
 */
function reaching(
  storybook: string,
  storyId: string,
  hosts: { requests?: string[]; remoteContent?: string[] },
): Parameters<typeof networkWarningsOf>[0][number] {
  return { storybook, storyId, hosts: { requests: [], remoteContent: [], ...hosts } }
}

/**
 * Gives the warnings' text as stderr prints it.
 */
function networkWarningOf(
  taken: Parameters<typeof networkWarningsOf>[0],
  silenceHosts: Parameters<typeof networkWarningsOf>[1],
): string {
  return warningsTextOf(networkWarningsOf(taken, silenceHosts))
}

describe('warningsTextOf of networkWarningsOf', () => {
  it('words the request line for several stories and for one', () => {
    expect(
      networkWarningOf(
        [
          reaching('web', 'data--a', { requests: ['api.example.com'] }),
          reaching('web', 'data--b', { requests: ['api.example.com'] }),
          reaching('web', 'other--a', { requests: ['solo.example.com'] }),
        ],
        [],
      ),
    ).toBe(
      'api.example.com: 2 stories (data--a, data--b). These stories make real network requests and may be ' +
        'unreliable.\n' +
        'solo.example.com: 1 story (other--a). This story makes real network requests and may be unreliable.\n',
    )
  })

  it('words the remote content line for several stories and for one', () => {
    expect(
      networkWarningOf(
        [
          reaching('web', 'a--a', { remoteContent: ['images.unsplash.com'] }),
          reaching('web', 'a--b', { remoteContent: ['images.unsplash.com'] }),
          reaching('web', 'b--a', { remoteContent: ['one.example.com'] }),
        ],
        [],
      ),
    ).toBe(
      'images.unsplash.com: 2 stories (a--a, a--b) show remote content. ' +
        'A CDN can serve it differently on another machine, so CI may fail.\n' +
        'one.example.com: 1 story (b--a) shows remote content. ' +
        'A CDN can serve it differently on another machine, so CI may fail.\n',
    )
  })

  it('names three story IDs and then an ellipsis', () => {
    const taken = ['a--a', 'a--b', 'a--c', 'a--d', 'a--e'].map((id) =>
      reaching('web', id, { remoteContent: ['images.unsplash.com'] }),
    )

    expect(networkWarningOf(taken, [])).toBe(
      'images.unsplash.com: 5 stories (a--a, a--b, a--c, …) show remote content. ' +
        'A CDN can serve it differently on another machine, so CI may fail.\n',
    )
    expect(networkWarningOf(taken.slice(0, 3), [])).toContain('3 stories (a--a, a--b, a--c) show')
  })

  it("counts a story's modes once and the same story ID of two Storybooks twice", () => {
    const warning = networkWarningOf(
      [
        reaching('web', 'a--a', { requests: ['api.example.com'] }),
        reaching('web', 'a--a', { requests: ['api.example.com'] }),
        reaching('docs', 'a--a', { requests: ['api.example.com'] }),
      ],
      [],
    )

    expect(warning).toBe(
      'api.example.com: 2 stories (web a--a, docs a--a). These stories make real network requests and may be ' +
        'unreliable.\n',
    )
  })

  it('puts the request lines before the remote content lines and sorts each kind by host', () => {
    const lines = networkWarningOf(
      [
        reaching('web', 'a--a', { requests: ['z.example.com', 'b.example.com'], remoteContent: ['y.example.com'] }),
        reaching('web', 'a--b', { requests: ['c.example.com'], remoteContent: ['a.example.com'] }),
      ],
      [],
    ).split('\n')

    expect(lines.map((line) => line.split(':')[0])).toEqual([
      'b.example.com',
      'c.example.com',
      'z.example.com',
      'a.example.com',
      'y.example.com',
      '',
    ])
  })

  it('gives an empty string when no story reaches a host', () => {
    expect(networkWarningOf([], [])).toBe('')
    expect(networkWarningOf([reaching('web', 'a--a', {})], [])).toBe('')
  })

  it('drops a silenced host from both kinds', () => {
    const taken = [
      reaching('web', 'a--a', {
        requests: ['api.example.com', 'keep.example.com'],
        remoteContent: ['api.example.com'],
      }),
    ]

    expect(networkWarningOf(taken, ['api.example.com'])).toBe(
      'keep.example.com: 1 story (a--a). This story makes real network requests and may be unreliable.\n',
    )
    expect(networkWarningOf(taken, ['api.example.com', 'keep.example.com'])).toBe('')
  })
})

describe('networkWarningsOf', () => {
  it('gives each host its kind, every story it reached, once each, and its line without the newline', () => {
    const taken = ['a--a', 'a--b', 'a--c', 'a--d'].map((id) => reaching('web', id, { requests: ['api.example.com'] }))

    expect(networkWarningsOf([...taken, reaching('web', 'a--a', { remoteContent: ['img.test'] })], [])).toEqual([
      {
        kind: 'real-requests',
        host: 'api.example.com',
        stories: ['a--a', 'a--b', 'a--c', 'a--d'].map((story) => ({ storybook: 'web', story })),
        message:
          'api.example.com: 4 stories (a--a, a--b, a--c, …). These stories make real network requests and may be ' +
          'unreliable.',
      },
      {
        kind: 'remote-content',
        host: 'img.test',
        stories: [{ storybook: 'web', story: 'a--a' }],
        message:
          'img.test: 1 story (a--a) shows remote content. A CDN can serve it differently on another machine, so CI ' +
          'may fail.',
      },
    ])
  })

  it("lists a story's modes once and the same story ID of two Storybooks twice, with each Storybook", () => {
    const [warning] = networkWarningsOf(
      [
        reaching('web', 'a--a', { requests: ['api.example.com'] }),
        reaching('web', 'a--a', { requests: ['api.example.com'] }),
        reaching('docs', 'a--a', { requests: ['api.example.com'] }),
      ],
      [],
    )

    expect(warning?.stories).toEqual([
      { storybook: 'web', story: 'a--a' },
      { storybook: 'docs', story: 'a--a' },
    ])
  })

  it('leaves out a silenced host', () => {
    const taken = [reaching('web', 'a--a', { requests: ['api.example.com', 'keep.test'] })]

    expect(networkWarningsOf(taken, ['*.example.com']).map(({ host }) => host)).toEqual(['keep.test'])
  })
})
