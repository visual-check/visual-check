import { describe, expect, it } from 'vitest'
import { readAddonMessage } from './read-message.js'

/**
 * The outcome of a check that finished.
 */
const checked = {
  result: 'checked',
  storybook: 'web',
  imagesFolder: '/project/.visual-check',
  snapshots: [{ id: 'a', images: { baseline: null, snapshot: 'snapshots/web/a.snapshot.png', diff: null } }],
  disabled: false,
  notices: ['A notice.'],
}

/**
 * The outcome of a check that a problem stopped.
 */
const stopped = { result: 'stopped', cause: 'config', message: 'No config.', notices: [] }

describe('readAddonMessage', () => {
  it.each([
    { message: { kind: 'ready', protocol: 1, version: '1.2.3' } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'preparing' } } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'browser', text: '' } } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'capturing', finished: 1, total: 2 } } },
    { message: { kind: 'finished', id: 'click-1', outcome: checked } },
    { message: { kind: 'finished', id: 'click-1', outcome: { ...checked, snapshots: [] } } },
    { message: { kind: 'finished', id: 'click-1', outcome: stopped } },
    { message: { kind: 'finished', id: 'click-1', outcome: { result: 'cancelled' } } },
  ])('reads $message', ({ message }) => {
    expect(readAddonMessage(message)).toEqual(message)
  })

  it('leaves out the fields it does not know', () => {
    const message = { kind: 'finished', id: 'click-1', outcome: { result: 'cancelled' } }

    expect(readAddonMessage({ ...message, written: [] })).toEqual(message)
  })

  it.each([
    { message: undefined },
    { message: null },
    { message: 'ready' },
    { message: [] },
    { message: {} },
    { message: { kind: 1 } },
    { message: { kind: 'updated', id: 'click-1' } },
    { message: { kind: 'ready', protocol: 2, version: '1.2.3' } },
    { message: { kind: 'ready', protocol: 1 } },
    { message: { kind: 'finished', outcome: checked } },
    { message: { kind: 'progress', progress: { step: 'preparing' } } },
    { message: { kind: 'progress', id: 1, progress: { step: 'preparing' } } },
    { message: { kind: 'progress', id: 'click-1' } },
    { message: { kind: 'progress', id: 'click-1', progress: {} } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'writing' } } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'browser' } } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'capturing', finished: 1 } } },
    { message: { kind: 'progress', id: 'click-1', progress: { step: 'capturing', finished: '1', total: 2 } } },
  ])('takes no junk: $message', ({ message }) => {
    expect(readAddonMessage(message)).toBeUndefined()
  })

  it.each([
    { outcome: undefined },
    { outcome: null },
    { outcome: 'cancelled' },
    { outcome: {} },
    { outcome: { ...checked, result: 'updated' } },
    { outcome: { ...checked, storybook: undefined } },
    { outcome: { ...checked, imagesFolder: undefined } },
    { outcome: { ...checked, imagesFolder: 1 } },
    { outcome: { ...checked, snapshots: undefined } },
    { outcome: { ...checked, snapshots: {} } },
    { outcome: { ...checked, snapshots: [null] } },
    { outcome: { ...checked, snapshots: [{ id: 'a' }] } },
    { outcome: { ...checked, snapshots: [{ id: 'a', images: { snapshot: 1 } }] } },
    { outcome: { ...checked, disabled: undefined } },
    { outcome: { ...checked, notices: undefined } },
    { outcome: { ...stopped, cause: 'docker' } },
    { outcome: { ...stopped, message: undefined } },
    { outcome: { ...stopped, notices: [1] } },
  ])('reads an end it can not read as a stopped check: $outcome', ({ outcome }) => {
    expect(readAddonMessage({ kind: 'finished', id: 'click-1', outcome })).toEqual({
      kind: 'finished',
      id: 'click-1',
      outcome: {
        result: 'stopped',
        cause: 'run',
        message:
          "The Storybook addon can't read the result of visual-check's process. " +
          'Install the same version of @visual-check/cli and @visual-check/storybook-addon, then restart Storybook.',
        notices: [],
      },
    })
  })
})
