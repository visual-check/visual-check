import { describe, expect, it } from 'vitest'
import { readAddonRequest } from './read-request.js'

/**
 * A valid request for a check.
 */
const check = {
  kind: 'check',
  id: 'click-1',
  storyId: 'a',
  configDir: '/project/.storybook',
  url: 'http://127.0.0.1:1',
}

/**
 * A valid request for an update.
 */
const update = { ...check, kind: 'update' }

describe('readAddonRequest', () => {
  it('reads a request for a check', () => {
    expect(readAddonRequest(check)).toEqual(check)
  })

  it('reads a request for an update', () => {
    expect(readAddonRequest(update)).toEqual(update)
  })

  it('reads a request to cancel', () => {
    expect(readAddonRequest({ kind: 'cancel', id: 'click-1' })).toEqual({ kind: 'cancel', id: 'click-1' })
  })

  it("leaves out the fields it doesn't know", () => {
    expect(readAddonRequest({ ...check, extra: true })).toEqual(check)
    expect(readAddonRequest({ kind: 'cancel', id: 'click-1', extra: true })).toEqual({ kind: 'cancel', id: 'click-1' })
  })

  it.each(['id', 'storyId', 'configDir', 'url'])("takes no check whose %s isn't a non-empty string", (field) => {
    expect(readAddonRequest({ ...check, [field]: undefined })).toBeUndefined()
    expect(readAddonRequest({ ...check, [field]: '' })).toBeUndefined()
    expect(readAddonRequest({ ...check, [field]: 1 })).toBeUndefined()
    expect(readAddonRequest({ ...check, [field]: null })).toBeUndefined()
  })

  it.each(['id', 'storyId', 'configDir', 'url'])("takes no update whose %s isn't a non-empty string", (field) => {
    expect(readAddonRequest({ ...update, [field]: undefined })).toBeUndefined()
    expect(readAddonRequest({ ...update, [field]: '' })).toBeUndefined()
  })

  it.each([undefined, '', 1])('takes no cancel whose id is %j', (id) => {
    expect(readAddonRequest({ kind: 'cancel', id })).toBeUndefined()
  })

  it.each([
    [undefined],
    [null],
    ['check'],
    [1],
    [true],
    [[]],
    [{}],
    [{ kind: 'update', id: 'click-1' }],
    [{ kind: 'toString', id: 'click-1' }],
  ])('takes no other message: %j', (message) => {
    expect(readAddonRequest(message)).toBeUndefined()
  })
})
