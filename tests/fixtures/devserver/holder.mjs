import { createServer } from 'node:http'

// Ignores SIGTERM, so stopping it needs the SIGKILL escalation (or taskkill /F on Windows).
process.on('SIGTERM', () => {})
const server = createServer((_req, res) => res.end('fixture ok')).listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log('\n  \u001b[32mVITE\u001b[39m fixture ready\n')
  console.log(`  ➜  Local:   http://localhost:${port}/`)
  console.log(`  ➜  Network: use --host to expose`)
})
