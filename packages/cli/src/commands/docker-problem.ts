import type { ContainerError } from '../container/container-error.js'

/**
 * Where a run is, which decides what the Docker problem's text suggests.
 */
export interface DockerProblemContext {
  /**
   * Whether visual-check runs inside a container.
   */
  insideContainer: boolean
  /**
   * The image the browser runs in: the config's `image`, or the browser package's `<tag>@<digest>`.
   */
  image: string
}

/**
 * Builds what to print for a Docker problem: its message, then the fixes. For Docker that is missing, stopped or
 * can't pull, those are to start or install Docker or set `platform: 'host'`, and inside a container also to use
 * visual-check's image as the job container. Windows containers have their fix in the message. Every line ends with a
 * newline.
 */
export function dockerProblemOf(error: ContainerError, context: DockerProblemContext): string {
  if (error.fix === 'linux-containers') {
    return `${error.message}\n`
  }

  const fixes = "Start or install Docker, or set platform: 'host' in the config.\n"
  const job = context.insideContainer
    ? `Inside a container, run visual-check in a job container on visual-check's image, ${context.image}, which needs no Docker.\n`
    : ''

  return `${error.message}\n${fixes}${job}`
}
