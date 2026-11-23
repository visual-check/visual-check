import { spawn } from 'node:child_process'
import type { AddonMessage, AddonRequest } from '@visual-check/cli/internal/addon-protocol'

/**
 * Sends a message to the process that forked this one.
 */
function send(message: AddonMessage): void {
  process.send?.(message)
}

/**
 * Ends a check or an update as stopped, with this process's ID as its message.
 */
function finish(id: string): void {
  send({
    kind: 'finished',
    id,
    outcome: { result: 'stopped', cause: 'run', message: String(process.pid), notices: [] },
  })
}

/**
 * What a check or an update does, by the ID of its story. Any other story's hangs until it's cancelled.
 */
const behaviours: Partial<Record<string, (id: string) => void>> = {
  ends: (id) => {
    send({ kind: 'progress', id, progress: { step: 'preparing' } })
    send({ kind: 'progress', id, progress: { step: 'capturing', finished: 0, total: 1 } })
    finish(id)
  },
  'says junk': (id) => {
    process.send?.('junk')
    process.send?.({ kind: 'progress', id })
    send({ kind: 'progress', id: 'another', progress: { step: 'preparing' } })
    finish('another')
    finish(id)
    finish(id)
  },
  'crashes with output': () => {
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`)

    process.stderr.write(`${lines.join('\n')}\n`, () => process.exit(7))
  },
  'crashes with a long line': () => {
    process.stderr.write(`${'a'.repeat(50_000)}b`, () => process.exit(7))
  },
  'crashes and leaves a process': () => {
    const left = spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 60_000)'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })

    process.stderr.write(`${left.pid}\n`, () => process.exit(7))
  },
  'ignores a cancel': (id) => send({ kind: 'progress', id, progress: { step: 'preparing' } }),
  'says what cannot be read': (id) => {
    process.send?.({ kind: 'progress', id, progress: { step: 'writing' } })
    process.send?.({ kind: 'finished', id, outcome: { result: 'checked', notices: [] } })
  },
  crashes: () => process.exit(7),
  'is killed': () => process.kill(process.pid, 'SIGKILL'),
}

/**
 * The ID of the story of the latest check or update.
 */
let latest = ''

process.on('disconnect', () => process.exit(0))
process.on('message', (request: AddonRequest) => {
  if (request.kind === 'check' || request.kind === 'update') {
    latest = request.storyId
    behaviours[latest]?.(request.id)
  } else if (latest !== 'ignores a cancel') {
    send({ kind: 'finished', id: request.id, outcome: { result: 'cancelled' } })
  }
})

send({ kind: 'ready', protocol: 1, version: '0.0.0' })
