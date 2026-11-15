import { describe, expect, it } from 'vitest'
import { BrowserDownloadError } from './browser-download-error.js'
import { proxyFor } from './proxy.js'

/**
 * An https download URL, which a proxy applies to.
 */
const httpsUrl = new URL('https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.78/zip')

/**
 * Gives the proxy for the URL as text, or `undefined` for none.
 */
function proxyTextFor(url: URL | string, environment: Record<string, string | undefined>): string | undefined {
  return proxyFor(new URL(url), environment)?.href
}

describe('proxyFor', () => {
  it('gives no proxy when no variable is set', () => {
    expect(proxyTextFor(httpsUrl, {})).toBeUndefined()
  })

  it('gives HTTPS_PROXY for an https URL', () => {
    expect(proxyTextFor(httpsUrl, { HTTPS_PROXY: 'http://proxy.example.com:3128' })).toBe(
      'http://proxy.example.com:3128/',
    )
  })

  it('reads https_proxy when HTTPS_PROXY is unset or empty', () => {
    expect(proxyTextFor(httpsUrl, { https_proxy: 'http://lower.example.com:3128' })).toBe(
      'http://lower.example.com:3128/',
    )
    expect(proxyTextFor(httpsUrl, { HTTPS_PROXY: '', https_proxy: 'http://lower.example.com:3128' })).toBe(
      'http://lower.example.com:3128/',
    )
  })

  it('prefers HTTPS_PROXY over https_proxy', () => {
    expect(
      proxyTextFor(httpsUrl, { HTTPS_PROXY: 'http://upper.example.com', https_proxy: 'http://lower.example.com' }),
    ).toBe('http://upper.example.com/')
  })

  it('gives no proxy when the variables are empty', () => {
    expect(proxyTextFor(httpsUrl, { HTTPS_PROXY: '', https_proxy: '' })).toBeUndefined()
  })

  it('sends an http URL directly', () => {
    expect(proxyTextFor('http://127.0.0.1:8080/zip', { HTTPS_PROXY: 'http://proxy.example.com' })).toBeUndefined()
  })

  it('reads a value without a scheme as http', () => {
    expect(proxyTextFor(httpsUrl, { HTTPS_PROXY: 'proxy.example.com:3128' })).toBe('http://proxy.example.com:3128/')
  })

  it('keeps the credentials in the proxy URL', () => {
    const proxy = proxyFor(httpsUrl, { HTTPS_PROXY: 'http://user:p%40ss@proxy.example.com:3128' })

    expect(proxy?.username).toBe('user')
    expect(proxy?.password).toBe('p%40ss')
  })

  it('rejects a value that is not a URL, naming the variable', () => {
    expect(() => proxyFor(httpsUrl, { https_proxy: 'not a proxy' })).toThrow(BrowserDownloadError)
    expect(() => proxyFor(httpsUrl, { https_proxy: 'not a proxy' })).toThrow(
      'The proxy in https_proxy must be an http:// URL, such as http://proxy.example.com:3128.',
    )
  })

  it('rejects a proxy whose scheme is not http', () => {
    expect(() => proxyFor(httpsUrl, { HTTPS_PROXY: 'socks5://proxy.example.com:1080' })).toThrow(
      'The proxy in HTTPS_PROXY must be an http:// URL, such as http://proxy.example.com:3128.',
    )
    expect(() => proxyFor(httpsUrl, { HTTPS_PROXY: 'https://proxy.example.com' })).toThrow(BrowserDownloadError)
  })

  it('rejects credentials with a % that is not encoded, naming the variable', () => {
    expect(() => proxyFor(httpsUrl, { HTTPS_PROXY: 'http://user:50%off@proxy.example.com:3128' })).toThrow(
      "The proxy in HTTPS_PROXY has a % in its user name or password that isn't encoded. Write it as %25.",
    )
    expect(() => proxyFor(httpsUrl, { https_proxy: 'http://50%off:password@proxy.example.com:3128' })).toThrow(
      BrowserDownloadError,
    )
    expect(proxyFor(httpsUrl, { HTTPS_PROXY: 'http://user:50%25off@proxy.example.com:3128' })?.password).toBe(
      '50%25off',
    )
  })

  it('never prints the value, which can hold credentials', () => {
    expect(() => proxyFor(httpsUrl, { HTTPS_PROXY: 'socks5://user:secret@proxy.example.com' })).toThrow(
      /^The proxy in HTTPS_PROXY must be an http:\/\/ URL, such as http:\/\/proxy\.example\.com:3128\.$/,
    )
  })

  describe('NO_PROXY', () => {
    const environment = { HTTPS_PROXY: 'http://proxy.example.com:3128' }

    /**
     * Whether the URL goes directly when `NO_PROXY` is set to the value.
     */
    function bypasses(url: string, noProxy: string): boolean {
      return proxyFor(new URL(url), { ...environment, NO_PROXY: noProxy }) === undefined
    }

    it('matches the host exactly', () => {
      expect(bypasses('https://example.com/zip', 'example.com')).toBe(true)
    })

    it('matches a subdomain, with or without a leading dot', () => {
      expect(bypasses('https://a.example.com/zip', 'example.com')).toBe(true)
      expect(bypasses('https://a.example.com/zip', '.example.com')).toBe(true)
      expect(bypasses('https://example.com/zip', '.example.com')).toBe(true)
    })

    it('does not match a host that only ends with the same letters', () => {
      expect(bypasses('https://badexample.com/zip', 'example.com')).toBe(false)
      expect(bypasses('https://badexample.com/zip', '.example.com')).toBe(false)
    })

    it('matches every host with *', () => {
      expect(bypasses('https://storage.googleapis.com/zip', '*')).toBe(true)
      expect(bypasses('https://storage.googleapis.com/zip', 'example.com, *')).toBe(true)
    })

    it('reads a comma-separated list, trimming whitespace and ignoring case', () => {
      expect(bypasses('https://Mirror.Example.com/zip', ' localhost , EXAMPLE.com ')).toBe(true)
      expect(bypasses('https://storage.googleapis.com/zip', ' localhost , example.com ')).toBe(false)
    })

    it('matches an entry with a port only on that port, 443 when the URL names none', () => {
      expect(bypasses('https://example.com/zip', 'example.com:443')).toBe(true)
      expect(bypasses('https://example.com:8443/zip', 'example.com:8443')).toBe(true)
      expect(bypasses('https://example.com/zip', 'example.com:8443')).toBe(false)
      expect(bypasses('https://example.com:8443/zip', 'example.com:443')).toBe(false)
    })

    it('matches an IP address and a bracketed IPv6 address', () => {
      expect(bypasses('https://10.0.0.5/zip', '10.0.0.5')).toBe(true)
      expect(bypasses('https://[::1]:8443/zip', '[::1]:8443')).toBe(true)
      expect(bypasses('https://[::1]/zip', '::1')).toBe(true)
    })

    it('reads no_proxy when NO_PROXY is unset or empty', () => {
      expect(proxyFor(httpsUrl, { ...environment, no_proxy: 'googleapis.com' })).toBeUndefined()
      expect(proxyFor(httpsUrl, { ...environment, NO_PROXY: '', no_proxy: 'googleapis.com' })).toBeUndefined()
    })

    it('prefers NO_PROXY over no_proxy', () => {
      expect(proxyFor(httpsUrl, { ...environment, NO_PROXY: 'example.com', no_proxy: 'googleapis.com' })?.href).toBe(
        'http://proxy.example.com:3128/',
      )
    })

    it('gives no proxy for an excluded host even when the proxy value is invalid', () => {
      expect(proxyFor(httpsUrl, { HTTPS_PROXY: 'not a proxy', NO_PROXY: '*' })).toBeUndefined()
    })
  })
})
