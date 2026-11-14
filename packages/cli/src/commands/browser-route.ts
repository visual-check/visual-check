import type { ContainerPlatform } from '../container/browser-container.js'

/**
 * How the browser in visual-check's container reaches a Storybook, as the rules in the browser and platform spec
 * decide:
 *
 * - `host`: on the machine's own network, with host networking (rule 4).
 * - `container:<id>`: on the network of the container the CLI runs in, which the Docker daemon knows (rule 2).
 * - `proxy`: on Docker's default bridge network, through the SOCKS proxy in the CLI, which connects from the CLI's
 *   machine (rules 3 and 5).
 */
export type ContainerRoute = 'host' | `container:${string}` | 'proxy'

/**
 * Where a run's browser runs: directly inside visual-check's image, or in visual-check's container on a platform, with
 * the route it reaches a Storybook by.
 */
export type BrowserPlace = { in: 'image' } | { in: 'container'; platform: ContainerPlatform; route: ContainerRoute }

/**
 * What decides how the browser reaches a Storybook.
 */
export type RouteFacts =
  | {
      /**
       * The CLI runs inside visual-check's image, and its marker fits.
       */
      insideImage: true
    }
  | {
      /**
       * The CLI runs outside visual-check's image, so the browser runs in visual-check's container.
       */
      insideImage: false
      /**
       * The platform the container runs on.
       */
      platform: ContainerPlatform
      /**
       * The ID of the container the CLI runs in, when the Docker daemon knows it, else `undefined`.
       */
      containerId: string | undefined
      /**
       * Whether Docker's engine is Docker Desktop's.
       */
      dockerDesktop: boolean
      /**
       * The OS the CLI runs on.
       */
      os: NodeJS.Platform
    }

/**
 * Gives where the browser runs and how it reaches a Storybook: the first of the five rules that matches, as the table in
 * the browser and platform spec (`docs/prd/05-browser-and-platform.md`) lists them.
 *
 * 1. Inside visual-check's image, the browser starts directly.
 * 2. Inside a container the Docker daemon knows, it joins that container's network.
 * 3. With Docker Desktop, on any OS, it goes through the SOCKS proxy.
 * 4. With any other engine on Linux, it uses host networking.
 * 5. Anywhere else, such as OrbStack or Colima on macOS, it goes through the SOCKS proxy.
 */
export function browserPlaceOf(facts: RouteFacts): BrowserPlace {
  if (facts.insideImage) {
    return { in: 'image' }
  }

  const { platform } = facts

  if (facts.containerId !== undefined) {
    return { in: 'container', platform, route: `container:${facts.containerId}` }
  }

  if (facts.dockerDesktop) {
    return { in: 'container', platform, route: 'proxy' }
  }

  if (facts.os === 'linux') {
    return { in: 'container', platform, route: 'host' }
  }

  return { in: 'container', platform, route: 'proxy' }
}
