import { describe, expect, it } from 'vitest'
import { systemReasonOf } from './system-reason.js'

/**
 * Builds an error as Node's file calls throw it: its message ends with the call's name and path.
 */
function fileError(reason: string, syscall: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${reason}, ${syscall} '${path}'`), { syscall })
}

describe('systemReasonOf', () => {
  it("gives a file call's reason without the call's name and path", () => {
    expect(systemReasonOf(fileError('EACCES: permission denied', 'open', '/a, b/c.png'))).toBe(
      'EACCES: permission denied',
    )
  })

  it('gives the whole message of an error with no call', () => {
    expect(systemReasonOf(new Error('Input buffer contains unsupported image format'))).toBe(
      'Input buffer contains unsupported image format',
    )
  })

  it("gives the whole message when it doesn't name its call", () => {
    expect(systemReasonOf(Object.assign(new Error('ENOSPC: no space left on device'), { syscall: 'write' }))).toBe(
      'ENOSPC: no space left on device',
    )
  })

  it('gives any other thrown value as text', () => {
    expect(systemReasonOf('gone')).toBe('gone')
  })
})
