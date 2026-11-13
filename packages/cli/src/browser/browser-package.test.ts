import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  browserPackageMessage,
  installCommand,
  isInRange,
  type PackageManager,
  parseMajors,
} from './browser-package.js'

describe('parseMajors', () => {
  it('reads one major', () => {
    expect(parseMajors('^157.0.0')).toEqual([157])
  })

  it('reads several majors with and without spaces', () => {
    expect(parseMajors('^157.0.0 || ^158.0.0')).toEqual([157, 158])
    expect(parseMajors('^157.0.0||^158.0.0')).toEqual([157, 158])
    expect(parseMajors('^157.0.0  ||  ^158.0.0 || ^159.0.0')).toEqual([157, 158, 159])
  })

  it.each(['>=157', '^157.1.0', '157', '', '^157.0.0 ||', '^157.0.0 || >=158'])('rejects %j', (range) => {
    expect(() => parseMajors(range)).toThrow(`got "${range}"`)
  })
})

describe('isInRange', () => {
  it('accepts a version of a listed major', () => {
    expect(isInRange('157.2.1', [157, 158])).toBe(true)
    expect(isInRange('158.0.0', [157, 158])).toBe(true)
  })

  it('rejects another major', () => {
    expect(isInRange('156.0.0', [157])).toBe(false)
    expect(isInRange('1570.0.0', [157])).toBe(false)
  })

  it('rejects a prerelease', () => {
    expect(isInRange('157.0.0-beta.1', [157])).toBe(false)
  })

  it('rejects garbage', () => {
    expect(isInRange('latest', [157])).toBe(false)
    expect(isInRange('', [157])).toBe(false)
  })
})

describe('installCommand', () => {
  const cases: [PackageManager, string][] = [
    ['npm', 'npm install --save-dev @visual-check/chromium@157'],
    ['pnpm', 'pnpm add --save-dev @visual-check/chromium@157'],
    ['yarn', 'yarn add --dev @visual-check/chromium@157'],
  ]

  it.each(cases)('builds the %s command', (packageManager, command) => {
    expect(installCommand(packageManager, 157)).toBe(command)
  })
})

describe('browserPackageMessage', () => {
  const npm = 'npm install --save-dev @visual-check/chromium@157'

  it('names a missing package', () => {
    expect(browserPackageMessage({ status: 'missing' }, '^157.0.0', [157], npm)).toBe(
      "The browser package @visual-check/chromium isn't installed. This CLI needs a version in ^157.0.0.\nInstall it: npm install --save-dev @visual-check/chromium@157\n",
    )
  })

  it('names an unreadable package and the reason', () => {
    expect(
      browserPackageMessage(
        { status: 'unreadable', reason: 'its package.json has no version' },
        '^157.0.0',
        [157],
        npm,
      ),
    ).toBe(
      "The browser package @visual-check/chromium can't be read: its package.json has no version.\nReinstall it: npm install --save-dev @visual-check/chromium@157\n",
    )
  })

  it('names an out-of-range version below the range', () => {
    expect(browserPackageMessage({ status: 'found', version: '156.0.0' }, '^157.0.0', [157], npm)).toBe(
      "The browser package @visual-check/chromium 156.0.0 is outside this CLI's range ^157.0.0.\nInstall a version in range: npm install --save-dev @visual-check/chromium@157\n",
    )
  })

  it('suggests upgrading the CLI for a version above the range', () => {
    expect(browserPackageMessage({ status: 'found', version: '158.1.0' }, '^157.0.0', [157], npm)).toBe(
      "The browser package @visual-check/chromium 158.1.0 is outside this CLI's range ^157.0.0.\nInstall a version in range: npm install --save-dev @visual-check/chromium@157\nOr upgrade @visual-check/cli to a version whose range includes 158.\n",
    )
  })
})

describe('the workspace', () => {
  it("has a browser package in the CLI's peer range", () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    const range = manifest.peerDependencies['@visual-check/chromium'] as string
    const browser = JSON.parse(
      readFileSync(createRequire(import.meta.url).resolve('@visual-check/chromium/package.json'), 'utf8'),
    ) as { version: string }
    expect(isInRange(browser.version, parseMajors(range))).toBe(true)
  })
})
