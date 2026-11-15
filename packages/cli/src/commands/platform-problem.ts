import type { ContainerPlatform } from '../container/browser-container.js'

/**
 * Gives what to print when the browser exited before its first capture because the machine can't run `platform`: the
 * cause and the fix, which is to turn on Rosetta for linux/amd64 or to set the other platform.
 */
export function platformProblemOf(platform: ContainerPlatform): string {
  const cause =
    "The browser exited before its first capture because its graphics process can't start: " +
    `this machine can't run ${platform}, as happens when Docker emulates it with QEMU.\n`

  return platform === 'linux/amd64'
    ? `${cause}Turn on Rosetta in your Docker runtime, or set platform to 'linux/arm64' in the config, which changes it for the whole project.\n`
    : `${cause}Set platform to 'linux/amd64' in the config, which changes it for the whole project.\n`
}
