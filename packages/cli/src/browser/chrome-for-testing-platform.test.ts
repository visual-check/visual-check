import { describe, expect, it } from 'vitest'
import { chromeForTestingPlatformOf } from './chrome-for-testing-platform.js'

describe('chromeForTestingPlatformOf', () => {
  it.each([
    ['linux', 'x64', 'linux64'],
    ['linux', 'arm64', 'linux-arm64'],
    ['darwin', 'x64', 'mac-x64'],
    ['darwin', 'arm64', 'mac-arm64'],
    ['win32', 'x64', 'win64'],
  ] as const)('maps %s/%s to %s', (os, arch, platform) => {
    expect(chromeForTestingPlatformOf(os, arch)).toEqual({ platform })
  })

  it('points Windows on Arm to linux/arm64', () => {
    const result = chromeForTestingPlatformOf('win32', 'arm64')

    expect(result).toEqual({ problem: expect.stringContaining('Windows on Arm') })
    expect(result).toEqual({ problem: expect.stringContaining("'linux/arm64'") })
  })

  it.each([
    ['freebsd', 'x64'],
    ['linux', 'ia32'],
  ] as const)('names %s/%s as having no build and points to the container platforms', (os, arch) => {
    const result = chromeForTestingPlatformOf(os, arch)

    expect(result).toEqual({ problem: expect.stringContaining(`Chrome for Testing build for ${os}/${arch}`) })
    expect(result).toEqual({ problem: expect.stringContaining("'linux/amd64' or 'linux/arm64'") })
  })
})
