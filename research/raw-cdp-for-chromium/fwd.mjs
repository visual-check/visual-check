// TCP forwarder inside the container: headless shell binds CDP to 127.0.0.1 only, ignoring --remote-debugging-address,
// so a published port reaches it through this. 0.0.0.0:<from> -> 127.0.0.1:<to>
import net from 'node:net'
const [from, to] = process.argv.slice(2).map(Number)
net.createServer((c) => { const u = net.connect(to, '127.0.0.1'); c.pipe(u); u.pipe(c); u.on('error', () => c.destroy()); c.on('error', () => u.destroy()) }).listen(from, '0.0.0.0')
