// PROTOTYPE, throwaway: a SOCKS5 proxy in visual-check's process, for a browser in a container on macOS. It connects
// from this host, so the Storybook URL resolves and routes as written. CONNECT only, no auth.
// Proxy scope research: logs each connection's timing (request, DNS lookup, connect, close) and bytes.
import net from 'node:net'

export const socksStats = { connections: 0, failed: 0 }
export type ConnLog = { host: string; port: number; t: number; lookupMs?: number; connectMs?: number; closeMs?: number; up: number; down: number; err?: string }
export const socksLog: ConnLog[] = []
let open = 0
export let maxOpen = 0

export function startSocks(host: string, port: number, onlyLoopback = false): Promise<net.Server> {
  const server = net.createServer((c) => {
    c.on('error', () => {})
    c.once('data', () => {
      c.write(Buffer.from([5, 0]))
      c.once('data', (req: Buffer) => {
        const t0 = performance.now()
        const atyp = req[3]
        let addr: string
        let off: number
        if (atyp === 1) { addr = Array.from(req.subarray(4, 8)).join('.'); off = 8 }
        else if (atyp === 3) { addr = req.subarray(5, 5 + req[4]).toString(); off = 5 + req[4] }
        else { addr = Array.from({ length: 8 }, (_, k) => req.readUInt16BE(4 + 2 * k).toString(16)).join(':'); off = 20 }
        const dport = req.readUInt16BE(off)
        const rest = req.subarray(off + 2)
        const reply = (code: number) => c.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))
        if (req[1] !== 1) { reply(7); c.end(); return }
        if (onlyLoopback && !['127.0.0.1', 'localhost', '0:0:0:0:0:0:0:1'].includes(addr)) { socksStats.failed++; reply(2); c.end(); return }
        socksStats.connections++
        const log: ConnLog = { host: addr, port: dport, t: Math.round(t0), up: 0, down: 0 }
        socksLog.push(log)
        open++
        if (open > maxOpen) maxOpen = open
        const up = net.connect(dport, addr)
        up.once('lookup', () => { log.lookupMs = +(performance.now() - t0).toFixed(1) })
        up.once('connect', () => { log.connectMs = +(performance.now() - t0).toFixed(1); reply(0); if (rest.length) up.write(rest); c.pipe(up); up.pipe(c) })
        c.on('data', (d) => { log.up += d.length })
        up.on('data', (d) => { log.down += d.length })
        up.on('error', (e) => { socksStats.failed++; log.err = e.message; if (up.connecting) reply(4); c.destroy() })
        let closed = false
        const done = () => { if (closed) return; closed = true; open--; log.closeMs = Math.round(performance.now() - t0) }
        c.on('close', () => { up.destroy(); done() })
        up.on('close', done)
      })
    })
  })
  return new Promise((r) => server.listen(port, host, () => r(server)))
}
