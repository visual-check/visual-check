import type { ContainerPlatform } from './browser-container.js'
import { ContainerError } from './container-error.js'
import { runDocker } from './run-docker.js'

/**
 * Whether Docker holds the image's content for the platform. It asks for that platform first, which the containerd image
 * store answers for a multi-platform image. An older engine rejects that flag, and its store holds one platform per
 * image, so a plain inspect answers there. Only stdout counts, since a warning on stderr says nothing about the image.
 */
async function isPresent(image: string, platform: ContainerPlatform): Promise<boolean> {
  const format = '{{.Os}}/{{.Architecture}}'

  for (const flags of [['--platform', platform], []]) {
    let inspected = ''
    const exitCode = await runDocker(
      ['image', 'inspect', ...flags, '--format', format, image],
      (text) => {
        inspected += text
      },
      () => undefined,
    )

    if (exitCode === 0) {
      return inspected.trim() === platform
    }
  }

  return false
}

/**
 * Pulls the image for the platform unless Docker already has it for that platform. Docker's progress goes to `progress` as it arrives.
 *
 * @public
 * @throws {ContainerError} When `docker` can't be run, or the pull fails.
 */
export async function pullMissingImage(
  image: string,
  platform: ContainerPlatform,
  progress: (text: string) => void,
): Promise<void> {
  if (await isPresent(image, platform)) {
    return
  }

  const pullExitCode = await runDocker(['pull', '--platform', platform, image], progress, progress)

  if (pullExitCode !== 0) {
    throw new ContainerError(
      `docker pull of ${image} for ${platform} failed with exit code ${pullExitCode}. ` +
        'Check that Docker is running, the image reference, and your access to its registry.',
    )
  }
}
