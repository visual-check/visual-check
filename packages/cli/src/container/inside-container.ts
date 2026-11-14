import { existsSync } from 'node:fs'

/**
 * Whether visual-check runs inside a container: Docker and Podman mark one with a file in its root, and Kubernetes sets
 * `KUBERNETES_SERVICE_HOST` in every pod.
 *
 * @public
 */
export function isInsideContainer(environment: Record<string, string | undefined>): boolean {
  return (
    existsSync('/.dockerenv') || existsSync('/run/.containerenv') || environment.KUBERNETES_SERVICE_HOST !== undefined
  )
}
