import { createServer, type Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\nonexistent-waxm', isPackaged: false, getVersion: () => '0.0.0', on: () => undefined } }))

import { probeSimulation } from '../../src/main/simulate'

const servers: Server[] = []

/** A local endpoint that answers every request with the given status, type and body. */
async function endpoint(status: number, type: string, body: string): Promise<string> {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(body)
    })
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}

afterAll(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))))

const nodeError = { code: 500, message: 'Internal Service Error', error: { code: 3040000, name: 'transaction_exception', what: 'Transaction exception', details: [] } }

describe('probeSimulation', () => {
  it('a node trace is available', async () => {
    const ep = await endpoint(200, 'application/json', JSON.stringify({ transaction_id: 'ab'.repeat(32), processed: { id: 'ab'.repeat(32), block_num: 1, action_traces: [] } }))
    expect(await probeSimulation(ep)).toBe('available')
  })
  it('a node error with its error code is available', async () => {
    const ep = await endpoint(500, 'application/json', JSON.stringify(nodeError))
    expect(await probeSimulation(ep)).toBe('available')
  })
  it('404 is unsupported, with or without a JSON body', async () => {
    expect(await probeSimulation(await endpoint(404, 'text/html', '<h1>Not found</h1>'))).toBe('unsupported')
    expect(await probeSimulation(await endpoint(404, 'application/json', '{"code":404,"message":"Not Found"}'))).toBe('unsupported')
  })
  it('a proxy page (403, 502, 200 HTML) is unknown', async () => {
    expect(await probeSimulation(await endpoint(403, 'text/html', '<h1>Forbidden</h1>'))).toBe('unknown')
    expect(await probeSimulation(await endpoint(502, 'text/html', 'Bad gateway'))).toBe('unknown')
    expect(await probeSimulation(await endpoint(200, 'text/html', '<html>welcome</html>'))).toBe('unknown')
  })
  it('a JSON error without the node fields is unknown', async () => {
    expect(await probeSimulation(await endpoint(403, 'application/json', '{"error":"forbidden"}'))).toBe('unknown')
    expect(await probeSimulation(await endpoint(502, 'application/json', '{"message":"upstream failed"}'))).toBe('unknown')
    expect(await probeSimulation(await endpoint(200, 'application/json', '{"ok":true}'))).toBe('unknown')
  })
  it('an endpoint that does not answer is unknown', async () => {
    expect(await probeSimulation('http://127.0.0.1:1')).toBe('unknown')
  })
})
