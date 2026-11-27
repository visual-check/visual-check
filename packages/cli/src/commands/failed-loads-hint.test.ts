import { describe, expect, it } from 'vitest'
import { failedLoadsHintMessageOf } from './failed-loads-hint.js'

describe('failedLoadsHintMessageOf', () => {
  it('points at the server, names http-server and fewer workers, and links the CI docs page', () => {
    expect(failedLoadsHintMessageOf()).toBe(
      "Storybook's server dropped the connection or never answered. A server that can't take many connections at " +
        'once, such as python3 -m http.server, does this under parallel workers. Serve the static build with npx ' +
        'http-server instead, or run fewer --workers. See https://visual-check.vercel.app/docs/ci',
    )
  })
})
