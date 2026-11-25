import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_RESPONSE_BYTES, nodeErrorMessage, normalizeEndpoint, request, RpcError } from '../../src/main/rpc'

describe('endpoint rules', () => {
  it('accepts https and strips paths', () => {
    expect(normalizeEndpoint('https://wax.greymass.com/v1/chain')).toBe('https://wax.greymass.com')
  })
  it('allows http only for this computer', () => {
    expect(normalizeEndpoint('http://127.0.0.1:8888')).toBe('http://127.0.0.1:8888')
    expect(() => normalizeEndpoint('http://wax.greymass.com')).toThrow()
  })
  it('refuses credentials and other schemes', () => {
    expect(() => normalizeEndpoint('https://user:pw@example.com')).toThrow()
    expect(() => normalizeEndpoint('file:///c:/x')).toThrow()
    expect(() => normalizeEndpoint('not a url')).toThrow()
  })
})

describe('node error messages', () => {
  it('prefers the assertion detail', () => {
    const body = { error: { what: 'Assert failure', details: [{ message: 'assertion failure with message: overdrawn balance' }] } }
    expect(nodeErrorMessage(body, 'x')).toBe('assertion failure with message: overdrawn balance')
  })
  it('skips the pending console line', () => {
    const body = { error: { what: 'Missing required authority', details: [{ message: 'alice <= alice::put pending console output: ' }, { message: 'missing authority of bob' }] } }
    expect(nodeErrorMessage(body, 'x')).toBe('missing authority of bob')
    const only = { error: { what: 'Missing required authority', details: [{ message: 'alice <= alice::put pending console output: ' }] } }
    expect(nodeErrorMessage(only, 'x')).toBe('Missing required authority')
  })
  it('falls back', () => {
    expect(nodeErrorMessage(null, 'HTTP 500')).toBe('HTTP 500')
  })
})

describe('request limits', () => {
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        const chunk = Buffer.alloc(1024 * 1024, 0x20)
        let sent = 0
        const write = (): void => {
          while (sent <= MAX_RESPONSE_BYTES) {
            sent += chunk.length
            if (!res.write(chunk)) return void res.once('drain', write)
          }
          res.end()
        }
        write()
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('{}'), 2000)
      } else if (req.url === '/err') {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { what: 'boom' } }))
      } else {
        res.end(JSON.stringify({ ok: true }))
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const addr = server.address()
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })
  afterAll(() => server.close())

  it('reads a normal answer', async () => {
    expect(await request(base, '/ok')).toEqual({ ok: true })
  })
  it('refuses answers over the size limit', async () => {
    await expect(request(base, '/big')).rejects.toThrow(/too large/)
  })
  it('times out', async () => {
    await expect(request(base, '/slow', { timeoutMs: 300 })).rejects.toThrow(`Could not reach ${base}: no answer within 0.3 s.`)
  })
  it('reports node errors with the status', async () => {
    const e = await request(base, '/err').catch((x) => x)
    expect(e).toBeInstanceOf(RpcError)
    expect((e as RpcError).status).toBe(500)
    expect((e as Error).message).toBe('boom')
  })
})
