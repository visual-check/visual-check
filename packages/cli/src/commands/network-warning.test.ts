import { describe, expect, it } from 'vitest'
import { networkWarningOf } from './network-warning.js'

/**
 * Builds the hosts one captured snapshot reached.
 */
function reaching(
  storybook: string,
  storyId: string,
  hosts: { requests?: string[]; remoteContent?: string[] },
): Parameters<typeof networkWarningOf>[0][number] {
  return { storybook, storyId, hosts: { requests: [], remoteContent: [], ...hosts } }
}

describe('networkWarningOf', () => {
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

  describe('silence entries', () => {
    /**
     * Whether the entries silence a request to the host.
     */
    function isSilenced(host: string, entries: string[]): boolean {
      return networkWarningOf([reaching('web', 'a--a', { requests: [host] })], entries) === ''
    }

    it('silences the exact host, with its port', () => {
      expect(isSilenced('api.example.com', ['api.example.com'])).toBe(true)
      expect(isSilenced('localhost:6006', ['localhost:6006'])).toBe(true)
      expect(isSilenced('api.example.com', ['other.example.com'])).toBe(false)
    })

    it('silences a host with a port by its hostname', () => {
      expect(isSilenced('localhost:6006', ['localhost'])).toBe(true)
      expect(isSilenced('localhost:6006', ['localhost:7007'])).toBe(false)
    })

    it('ignores case', () => {
      expect(isSilenced('api.example.com', ['API.Example.com'])).toBe(true)
      expect(isSilenced('a.example.com', ['*.EXAMPLE.com'])).toBe(true)
    })

    it('silences the subdomains of a wildcard entry, at any depth, but not the domain itself', () => {
      expect(isSilenced('a.example.com', ['*.example.com'])).toBe(true)
      expect(isSilenced('a.b.example.com', ['*.example.com'])).toBe(true)
      expect(isSilenced('a.example.com:8443', ['*.example.com'])).toBe(true)
      expect(isSilenced('a.example.com:8443', ['*.example.com:8443'])).toBe(true)
      expect(isSilenced('a.example.com:9000', ['*.example.com:8443'])).toBe(false)
      expect(isSilenced('example.com', ['*.example.com'])).toBe(false)
      expect(isSilenced('badexample.com', ['*.example.com'])).toBe(false)
    })
  })
})
