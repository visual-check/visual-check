import { describe, expect, it } from 'vitest'
import { updateSnapshotWith } from '../channel-events/state.fixture.js'
import { updateRowOf } from './update-row.js'

describe('updateRowOf', () => {
  it('gives the whole row of a written baseline', () => {
    expect(updateRowOf(updateSnapshotWith())).toEqual({
      key: 'card--default',
      label: 'Default',
      status: 'written',
      statusText: 'Written',
      flaky: false,
      message: 'Written: missing',
      reason: null,
      details: [],
      hints: [],
      path: '.visual-check/baselines/card--default.png',
    })
  })

  it('says an identical baseline is untouched', () => {
    const snapshot = updateSnapshotWith(
      { message: 'Untouched: identical, byte for byte' },
      { status: 'kept', reason: null },
    )

    expect(updateRowOf(snapshot)).toMatchObject({ status: 'kept', statusText: 'Untouched', reason: null })
  })

  it("gives a broken story's reason, details and hints", () => {
    const snapshot = updateSnapshotWith(
      {
        message: 'The story changed after its capture.',
        details: { timeoutMs: 5000 },
        hints: [{ kind: 'remote-content', hosts: ['a.test'], message: 'Mask a.test.' }],
      },
      { status: 'broken', reason: 'changed-after-capture' },
    )

    expect(updateRowOf(snapshot)).toMatchObject({
      status: 'broken',
      statusText: 'Broken story',
      reason: 'changed-after-capture',
      details: ['Timeout: 5000 ms'],
      hints: ['Mask a.test.'],
    })
  })

  it('names the mode and marks a flaky snapshot', () => {
    const snapshot = updateSnapshotWith({
      id: 'card--default.dark',
      mode: 'dark',
      flaky: true,
      baseline: '.visual-check/baselines/card--default.dark.png',
    })

    expect(updateRowOf(snapshot)).toMatchObject({
      key: 'card--default.dark',
      label: 'dark',
      flaky: true,
      path: '.visual-check/baselines/card--default.dark.png',
    })
  })
})
