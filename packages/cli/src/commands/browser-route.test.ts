import { describe, expect, it } from 'vitest'
import { browserPlaceOf, type RouteFacts } from './browser-route.js'

/**
 * The ID of the container the CLI runs in, in the cases where the Docker daemon knows it.
 */
const containerId = 'a'.repeat(64)

/**
 * The facts of a CLI outside visual-check's image, on Linux, with no known container and an engine that isn't Docker
 * Desktop's. A case overrides what it tests.
 */
const outsideImage = {
  insideImage: false,
  platform: 'linux/amd64',
  containerId: undefined,
  dockerDesktop: false,
  os: 'linux',
} satisfies RouteFacts

describe('browserPlaceOf', () => {
  it("starts the browser directly inside visual-check's image (rule 1)", () => {
    expect(browserPlaceOf({ insideImage: true })).toEqual({ in: 'image' })
  })

  it('joins the container the CLI runs in when the Docker daemon knows it (rule 2)', () => {
    expect(browserPlaceOf({ ...outsideImage, containerId })).toEqual({
      in: 'container',
      platform: 'linux/amd64',
      route: `container:${containerId}`,
    })
  })

  it('prefers a known container over Docker Desktop, on any OS', () => {
    expect(browserPlaceOf({ ...outsideImage, containerId, dockerDesktop: true, os: 'darwin' })).toEqual({
      in: 'container',
      platform: 'linux/amd64',
      route: `container:${containerId}`,
    })
  })

  it.each(['linux', 'darwin', 'win32'] as const)('goes through the proxy with Docker Desktop on %s (rule 3)', (os) => {
    expect(browserPlaceOf({ ...outsideImage, dockerDesktop: true, os })).toEqual({
      in: 'container',
      platform: 'linux/amd64',
      route: 'proxy',
    })
  })

  it('uses host networking with any other engine on Linux (rule 4)', () => {
    expect(browserPlaceOf(outsideImage)).toEqual({ in: 'container', platform: 'linux/amd64', route: 'host' })
  })

  it.each(['darwin', 'win32', 'freebsd'] as const)(
    'goes through the proxy with any other engine on %s (rule 5)',
    (os) => {
      expect(browserPlaceOf({ ...outsideImage, os })).toEqual({
        in: 'container',
        platform: 'linux/amd64',
        route: 'proxy',
      })
    },
  )

  it("keeps the config's platform", () => {
    expect(browserPlaceOf({ ...outsideImage, platform: 'linux/arm64' })).toEqual({
      in: 'container',
      platform: 'linux/arm64',
      route: 'host',
    })
  })
})
