import { createServer } from 'node:http'

const server = createServer((_req, res) => res.end('baseline')).listen(0, '127.0.0.1', () => {
  console.log(`baseline listening on http://127.0.0.1:${server.address().port}`)
})
