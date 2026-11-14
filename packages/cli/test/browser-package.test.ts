import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageFolder = fileURLToPath(new URL('..', import.meta.url))
const { version } = JSON.parse(readFileSync(join(packageFolder, 'package.json'), 'utf8')) as { version: string }
const temporaryFolders: string[] = []

/**
 * Copies the built CLI into a fresh temporary folder, so module resolution can't reach the workspace's node_modules
 * beyond jiti, which the binary needs to start.
 * When `browserVersion` is given, also installs a fake browser package of that version there.
 */
function setUp(browserVersion?: string, manifest: Record<string, unknown> = {}): string {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-'))

  temporaryFolders.push(folder)
  // The config search stops at the `.git` folder, so it can't find a config above the temporary folder.
  mkdirSync(join(folder, '.git'))
  writeFileSync(join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  cpSync(join(packageFolder, 'dist'), join(folder, 'dist'), { recursive: true })
  cpSync(join(packageFolder, 'package.json'), join(folder, 'package.json'))
  // The binary loads jiti when it starts, so jiti is the one package the copy gets from the workspace.
  mkdirSync(join(folder, 'node_modules'))
  symlinkSync(
    dirname(createRequire(import.meta.url).resolve('jiti/package.json')),
    join(folder, 'node_modules', 'jiti'),
  )

  if (browserVersion !== undefined) {
    const browserFolder = join(folder, 'node_modules', '@visual-check', 'chromium')

    mkdirSync(browserFolder, { recursive: true })
    writeFileSync(
      join(browserFolder, 'package.json'),
      JSON.stringify({
        name: '@visual-check/chromium',
        version: browserVersion,
        exports: { './package.json': './package.json' },
        ...manifest,
      }),
    )
  }

  return folder
}

/**
 * Runs the copied binary in the temporary folder, with `test` unless the case gives arguments. The user agent is unset
 * unless the case gives one, because Vitest runs under pnpm. NODE_PATH is unset too, because pnpm points it at the
 * workspace's node_modules.
 */
function run(folder: string, options: { arguments?: string[]; userAgent?: string; ci?: boolean } = {}) {
  const environment = { ...process.env }

  delete environment.npm_config_user_agent
  delete environment.NODE_PATH

  if (options.userAgent !== undefined) {
    environment.npm_config_user_agent = options.userAgent
  }

  if (options.ci === true) {
    environment.CI = 'true'
  }

  return spawnSync(process.execPath, [join(folder, 'dist', 'bin.js'), ...(options.arguments ?? ['test'])], {
    encoding: 'utf8',
    cwd: folder,
    env: environment,
  })
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('browser package check', () => {
  it('does not run for init', () => {
    const result = run(setUp(), { arguments: ['init'] })

    expect(result.status).toBe(2)
    expect(result.stderr).toBe("visual-check init isn't available yet. Write visual-check.config.ts by hand for now.\n")
  })

  it('exits 2 and names the npm install command when the package is missing', () => {
    const result = run(setUp())

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("isn't installed")
    expect(result.stderr).toContain('npm install --save-dev @visual-check/chromium@157')
  })

  it('exits 2 and names the version and the command when the package is out of range', () => {
    const result = run(setUp('156.0.0'))

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('156.0.0')
    expect(result.stderr).toContain('npm install --save-dev @visual-check/chromium@157')
  })

  it('passes the check for a version in range', () => {
    const result = run(setUp('157.2.1'))

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No visual-check.config.ts')
  })

  it('writes the pnpm command for a pnpm user agent', () => {
    const result = run(setUp(), { userAgent: 'pnpm/9.12.3 npm/? node/v22.23.1 darwin arm64' })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('pnpm add --save-dev @visual-check/chromium@157')
  })

  it('exits 2 when the package has no version', () => {
    const result = run(setUp('1.0.0', { version: undefined }))

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("can't be read")
    expect(result.stderr).toContain('its package.json has no version')
  })

  it('exits 2 when the package does not export its package.json', () => {
    const result = run(setUp('157.0.0', { exports: {} }))

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("can't be read")
  })

  it('exits 2 with the CI message for update in CI, before the browser package check', () => {
    const result = run(setUp(), { arguments: ['update'], ci: true })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('visual-check update only runs locally')
    expect(result.stderr).not.toContain("isn't installed")
  })

  it('prints the version for --version without the package', () => {
    const result = run(setUp(), { arguments: ['--version'] })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${version}\n`)
  })
})
