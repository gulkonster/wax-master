// A keep-alive socket the server closed while the app sat idle: the first
// request on it fails with "fetch failed"; the request is sent once more on a
// new connection, to the same URL, and only when no answer arrived.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleConnection, request, RpcError } from '../../src/main/rpc'

function staleError(code = 'UND_ERR_SOCKET'): Error {
  const cause = Object.assign(new Error('other side closed'), { code })
  return Object.assign(new TypeError('fetch failed'), { cause })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A fake fetch that fails the first `failures` calls with the given error, then answers. */
function fakeFetch(failures: Error[], answer: () => Response = () => jsonResponse({ ok: true })): { calls: { url: string; body: unknown }[]; fn: typeof fetch } {
  const calls: { url: string; body: unknown }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body })
    const f = failures.shift()
    if (f) throw f
    return answer()
  }) as typeof fetch
  return { calls, fn }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('broken connection detection', () => {
  it('knows the codes of a socket closed by the other side', () => {
    expect(isStaleConnection(staleError('UND_ERR_SOCKET'))).toBe(true)
    expect(isStaleConnection(staleError('ECONNRESET'))).toBe(true)
    expect(isStaleConnection(staleError('EPIPE'))).toBe(true)
  })
  it('does not treat other failures as a broken connection', () => {
    expect(isStaleConnection(staleError('ENOTFOUND'))).toBe(false)
    expect(isStaleConnection(staleError('ECONNREFUSED'))).toBe(false)
    expect(isStaleConnection(new TypeError('fetch failed'))).toBe(false)
    expect(isStaleConnection(null)).toBe(false)
  })
})

describe('request on a stale keep-alive connection', () => {
  it('a read that fails once on a broken connection is sent again and answers', async () => {
    const f = fakeFetch([staleError()])
    vi.stubGlobal('fetch', f.fn)
    expect(await request('https://node-a.example', '/v1/chain/get_info', { body: {} })).toEqual({ ok: true })
    expect(f.calls).toHaveLength(2)
    expect(f.calls.map((c) => c.url)).toEqual(['https://node-a.example/v1/chain/get_info', 'https://node-a.example/v1/chain/get_info'])
  })

  it('send_transaction is sent again with the same bytes to the same endpoint only', async () => {
    const f = fakeFetch([staleError('ECONNRESET')], () => jsonResponse({ transaction_id: 'abc' }))
    vi.stubGlobal('fetch', f.fn)
    const body = { signatures: ['SIG_K1_x'], compression: 0, packed_context_free_data: '', packed_trx: '00ff' }
    expect(await request('https://node-a.example', '/v1/chain/send_transaction', { body, timeoutMs: 30_000 })).toEqual({ transaction_id: 'abc' })
    expect(f.calls).toHaveLength(2)
    expect(new Set(f.calls.map((c) => c.url))).toEqual(new Set(['https://node-a.example/v1/chain/send_transaction']))
    expect(f.calls[1].body).toBe(f.calls[0].body)
  })

  it('repeats at most once', async () => {
    const f = fakeFetch([staleError(), staleError()])
    vi.stubGlobal('fetch', f.fn)
    const e = await request('https://node-a.example', '/v1/chain/get_info', { body: {} }).catch((x) => x)
    expect(e).toBeInstanceOf(RpcError)
    expect((e as Error).message).toMatch(/^Network error: fetch failed/)
    expect(f.calls).toHaveLength(2)
  })

  it('other network failures are not repeated', async () => {
    const f = fakeFetch([staleError('ENOTFOUND')])
    vi.stubGlobal('fetch', f.fn)
    await expect(request('https://node-a.example', '/v1/chain/get_info', { body: {} })).rejects.toThrow(/Network error/)
    expect(f.calls).toHaveLength(1)
  })

  it('a node answer (even an error) is never sent again', async () => {
    const f = fakeFetch([], () => jsonResponse({ error: { what: 'boom' } }, 500))
    vi.stubGlobal('fetch', f.fn)
    await expect(request('https://node-a.example', '/v1/chain/send_transaction', { body: {} })).rejects.toThrow('boom')
    expect(f.calls).toHaveLength(1)
  })

  it('retryStale: false sends once', async () => {
    const f = fakeFetch([staleError()])
    vi.stubGlobal('fetch', f.fn)
    await expect(request('https://node-a.example', '/v1/chain/get_info', { body: {}, retryStale: false })).rejects.toThrow(/Network error/)
    expect(f.calls).toHaveLength(1)
  })
})
