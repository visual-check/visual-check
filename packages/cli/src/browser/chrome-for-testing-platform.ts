/**
 * The platforms Chrome for Testing builds its headless shell for that visual-check carries, by the names its downloads
 * use.
 */
export const chromeForTestingPlatforms = ['linux64', 'linux-arm64', 'mac-x64', 'mac-arm64', 'win64'] as const

/**
 * One of Chrome for Testing's platforms, such as `mac-arm64`. Not the config's `platform`.
 *
 * @public
 */
export type ChromeForTestingPlatform = (typeof chromeForTestingPlatforms)[number]

/**
 * Maps the machine's operating system and architecture, as Node names them, to the Chrome for Testing platform whose
 * headless shell runs on it. Gives the problem that exits 2 when visual-check has no Chrome for Testing build for the
 * machine.
 *
 * @public
 */
export function chromeForTestingPlatformOf(
  os: NodeJS.Platform,
  arch: NodeJS.Architecture,
): { platform: ChromeForTestingPlatform } | { problem: string } {
  const pair = `${os}/${arch}`

  switch (pair) {
    case 'linux/x64':
      return { platform: 'linux64' }
    case 'linux/arm64':
      return { platform: 'linux-arm64' }
    case 'darwin/x64':
      return { platform: 'mac-x64' }
    case 'darwin/arm64':
      return { platform: 'mac-arm64' }
    case 'win32/x64':
      return { platform: 'win64' }
    case 'win32/arm64':
      return {
        problem:
          "Chrome for Testing has no build for Windows on Arm, so platform: 'host' can't run here. " +
          "Set platform to 'linux/arm64' in the config to run the browser in visual-check's container.",
      }
    default:
      return {
        problem:
          `visual-check has no Chrome for Testing build for ${pair}, so platform: 'host' can't run here. ` +
          "Set platform to 'linux/amd64' or 'linux/arm64' in the config " +
          "to run the browser in visual-check's container.",
      }
  }
}
