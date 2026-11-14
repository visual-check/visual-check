import { describe, expect, it } from 'vitest'
import { platformProblemOf } from './platform-problem.js'

describe('platformProblemOf', () => {
  it('names both fixes for linux/amd64', () => {
    expect(platformProblemOf('linux/amd64')).toBe(
      "The browser exited before its first capture because its graphics process can't start: this machine can't run " +
        'linux/amd64, as happens when Docker emulates it with QEMU.\n' +
        "Turn on Rosetta in your Docker runtime, or set platform to 'linux/arm64' in the config, which changes it for " +
        'the whole project.\n',
    )
  })

  it('names the other platform for linux/arm64', () => {
    expect(platformProblemOf('linux/arm64')).toBe(
      "The browser exited before its first capture because its graphics process can't start: this machine can't run " +
        'linux/arm64, as happens when Docker emulates it with QEMU.\n' +
        "Set platform to 'linux/amd64' in the config, which changes it for the whole project.\n",
    )
  })
})
