import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * The environment variables the fake `docker` reads.
 */
const fakeKeys = [
  'FAKE_DOCKER_DIR',
  'FAKE_DOCKER_PRESENT',
  'FAKE_DOCKER_IMAGE_PLATFORM',
  'FAKE_DOCKER_ENGINE',
  'FAKE_DOCKER_PULL_EXIT',
  'FAKE_DOCKER_KILL',
]

/**
 * What the fake `docker` does, in the `docker` subcommands it handles.
 */
export interface FakeDockerBehaviour {
  /**
   * Whether `docker image inspect` finds the image. True by default.
   */
  imagePresent?: boolean
  /**
   * The platform the present image is for. `linux/amd64` by default.
   */
  imagePlatform?: string
  /**
   * The engine's image store. `classic` holds one platform per image and answers `--platform` with it, or `/` when the
   * flag names another. `containerd` does too, but prints `/` without the flag and a warning on stderr. `old` rejects
   * the `--platform` flag. `classic` by default.
   */
  engine?: 'classic' | 'containerd' | 'old'
  /**
   * The exit code of `docker pull`. 0 by default.
   */
  pullExitCode?: number
  /**
   * What `docker kill` does: `stop` signals the matching `docker run`, which exits with 137 a moment later, as with
   * real Docker, `fail` exits 1 and leaves it running, and `ignore` exits 0 and leaves it running. `stop` by default.
   */
  kill?: 'stop' | 'fail' | 'ignore'
}

/**
 * A fake `docker` on PATH, and what it recorded.
 */
export interface FakeDocker {
  /**
   * Every call the fake received, as its arguments, oldest first.
   */
  calls: () => string[][]
  /**
   * Puts PATH back as it was and removes the fake.
   */
  remove: () => void
}

/**
 * The fake `docker` program. It records its arguments and acts per subcommand, steered by environment variables: as a
 * browser, `run` echoes its stdin to stdout, writes a line to stderr and exits when its stdin ends.
 */
const script = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const dir = process.env.FAKE_DOCKER_DIR
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(args) + '\\n')

if (args[0] === 'image' && args[1] === 'inspect') {
  const engine = process.env.FAKE_DOCKER_ENGINE
  const platformFlag = args.indexOf('--platform')
  const held = process.env.FAKE_DOCKER_IMAGE_PLATFORM
  let answer = held
  let exitCode = 0

  if (process.env.FAKE_DOCKER_PRESENT !== '1') {
    exitCode = 1
    answer = ''
  } else if (platformFlag !== -1) {
    if (engine === 'old') {
      process.stderr.write('unknown flag: --platform\\n')
      exitCode = 1
      answer = ''
    } else if (args[platformFlag + 1] !== held) {
      answer = '/'
    }
  } else if (engine === 'containerd') {
    answer = '/'
  }

  if (engine === 'containerd') {
    process.stderr.write('warning: multi-platform image\\n')
  }
  process.stdout.write(answer === '' ? '' : answer + '\\n', () => process.exit(exitCode))
} else if (args[0] === 'pull') {
  process.stdout.write('pull progress 1\\npull progress 2\\n')
  process.stderr.write('pull progress 3\\n', () => process.exit(Number(process.env.FAKE_DOCKER_PULL_EXIT)))
} else if (args[0] === 'run') {
  const name = args[args.indexOf('--name') + 1]
  fs.writeFileSync(path.join(dir, name + '.pid'), String(process.pid))
  process.on('SIGTERM', () => setTimeout(() => process.exit(137), 100))
  process.stdin.pipe(process.stdout)
  process.stderr.write('browser started\\n')
} else if (args[0] === 'kill') {
  const mode = process.env.FAKE_DOCKER_KILL
  if (mode === 'fail') {
    process.exit(1)
  }
  if (mode === 'stop') {
    const pid = Number(fs.readFileSync(path.join(dir, args[1] + '.pid'), 'utf8'))
    process.kill(pid, 'SIGTERM')
  }
  process.exit(0)
}
`

/**
 * Puts a fake `docker` first on PATH, acting as `behaviour` says. The test calls `remove` afterwards.
 */
export function installFakeDocker(behaviour: FakeDockerBehaviour = {}): FakeDocker {
  const dir = mkdtempSync(join(tmpdir(), 'fake-docker-'))
  const program = join(dir, 'docker')
  const oldPath = process.env.PATH

  writeFileSync(program, script)
  chmodSync(program, 0o755)
  writeFileSync(join(dir, 'calls.log'), '')

  process.env.FAKE_DOCKER_DIR = dir
  process.env.FAKE_DOCKER_PRESENT = behaviour.imagePresent === false ? '0' : '1'
  process.env.FAKE_DOCKER_IMAGE_PLATFORM = behaviour.imagePlatform ?? 'linux/amd64'
  process.env.FAKE_DOCKER_ENGINE = behaviour.engine ?? 'classic'
  process.env.FAKE_DOCKER_PULL_EXIT = String(behaviour.pullExitCode ?? 0)
  process.env.FAKE_DOCKER_KILL = behaviour.kill ?? 'stop'
  process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`

  return {
    calls: () =>
      readFileSync(join(dir, 'calls.log'), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[]),
    remove: () => {
      if (oldPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = oldPath
      }

      for (const key of fakeKeys) {
        delete process.env[key]
      }

      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Makes PATH hold an empty folder only, so no `docker` is found. The returned function puts PATH back.
 */
export function removeDockerFromPath(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'no-docker-'))
  const oldPath = process.env.PATH

  process.env.PATH = dir

  return () => {
    if (oldPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = oldPath
    }

    rmSync(dir, { recursive: true, force: true })
  }
}
