// A keep-alive socket the server closed while the app sat idle: the first
// request on it fails with "fetch failed"; the request is sent once more on a
// new connection, to the same URL, and only when no answer arrived.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleConnection, noAnswerMessage, request, RpcError } from '../../src/main/rpc'

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
    expect((e as Error).message).toBe('Could not reach https://node-a.example: the connection was closed before an answer came.')
    expect(f.calls).toHaveLength(2)
  })

  it('other network failures are not repeated', async () => {
    const f = fakeFetch([staleError('ENOTFOUND')])
    vi.stubGlobal('fetch', f.fn)
    await expect(request('https://node-a.example', '/v1/chain/get_info', { body: {} })).rejects.toThrow('Could not reach https://node-a.example: the host name could not be found')
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
    await expect(request('https://node-a.example', '/v1/chain/get_info', { body: {}, retryStale: false })).rejects.toThrow('Could not reach https://node-a.example: the connection was closed before an answer came.')
    expect(f.calls).toHaveLength(1)
  })
})

describe('text of a request that got no answer', () => {
  /** A failure as the built-in fetch reports it: "fetch failed" with a cause carrying a code and a remote text. */
  function failure(code?: string, causeText = 'remote said <script>secret body</script>'): Error {
    const cause = Object.assign(new Error(causeText), code ? { code } : {})
    return Object.assign(new TypeError('fetch failed'), { cause })
  }

  const cases: [string | undefined, string][] = [
    ['ENOTFOUND', 'the host name could not be found (check the internet connection)'],
    ['EAI_AGAIN', 'the host name could not be found (check the internet connection)'],
    ['ECONNREFUSED', 'the connection was refused'],
    ['ETIMEDOUT', 'the connection timed out'],
    ['UND_ERR_CONNECT_TIMEOUT', 'the connection timed out'],
    ['ECONNRESET', 'the connection was closed before an answer came'],
    ['EPIPE', 'the connection was closed before an answer came'],
    ['ECONNABORTED', 'the connection was closed before an answer came'],
    ['UND_ERR_SOCKET', 'the connection was closed before an answer came'],
    ['UND_ERR_CLOSED', 'the connection was closed before an answer came'],
    ['CERT_HAS_EXPIRED', "the endpoint's certificate was not accepted (CERT_HAS_EXPIRED)"],
    ['ERR_TLS_CERT_ALTNAME_INVALID', "the endpoint's certificate was not accepted (ERR_TLS_CERT_ALTNAME_INVALID)"],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', "the endpoint's certificate was not accepted (UNABLE_TO_VERIFY_LEAF_SIGNATURE)"],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', "the endpoint's certificate was not accepted (DEPTH_ZERO_SELF_SIGNED_CERT)"],
    ['SELF_SIGNED_CERT_IN_CHAIN', "the endpoint's certificate was not accepted (SELF_SIGNED_CERT_IN_CHAIN)"],
    ['EHOSTUNREACH', 'network error (EHOSTUNREACH)'],
    [undefined, 'network error']
  ]

  for (const [code, reason] of cases) {
    it(`${code ?? 'no code'}: ${reason}`, async () => {
      // Every attempt fails the same way (a broken connection is repeated once).
      const f = fakeFetch([failure(code), failure(code)])
      vi.stubGlobal('fetch', f.fn)
      const body = { secret: 'request body text' }
      const e = (await request('https://node-a.example:8888', '/v1/chain/get_account?x=1', { body }).catch((x) => x)) as RpcError
      expect(e).toBeInstanceOf(RpcError)
      expect(e.status).toBe(0)
      expect(e.message).toBe(`Could not reach https://node-a.example:8888: ${reason}.`)
      expect(e.message).not.toMatch(/fetch failed|get_account|x=1|request body|remote said|script/)
    })
  }

  it('a refused redirect says so', () => {
    const redirect = Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') })
    expect(noAnswerMessage('https://node-a.example', redirect)).toBe('Could not reach https://node-a.example: the endpoint answered with a redirect, which is not followed.')
  })

  it('the time limit: no answer within N s', async () => {
    vi.stubGlobal('fetch', ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError', code: 20 }))))) as typeof fetch)
    const e = (await request('https://node-a.example', '/v1/chain/get_info', { body: {}, timeoutMs: 1000 }).catch((x) => x)) as RpcError
    expect(e.status).toBe(0)
    expect(e.message).toBe('Could not reach https://node-a.example: no answer within 1 s.')
    expect(noAnswerMessage('https://node-a.example/v1/x?y=1', new Error('x'), { timedOut: true, timeoutMs: 15_000 })).toBe('Could not reach https://node-a.example: no answer within 15 s.')
  })
})

describe('read calls over several endpoints', () => {
  it('every endpoint failed: the selected endpoint\'s text and "(n endpoints tried)"; one endpoint: no count', async () => {
    const { readCall } = await import('../../src/main/networks')
    const net = { id: 'x', name: 'X', kind: 'testnet', chainId: 'f1'.repeat(32), endpoints: ['https://a.example', 'https://b.example', 'https://c.example'], currentEndpoint: 1 }
    const tried: string[] = []
    const fail = async (ep: string): Promise<never> => {
      tried.push(ep)
      throw new RpcError(noAnswerMessage(ep, failure('ECONNREFUSED')), 0)
    }
    await expect(readCall(fail, net as never)).rejects.toThrow('Could not reach https://b.example: the connection was refused. (3 endpoints tried)')
    expect(tried).toEqual(['https://b.example', 'https://c.example', 'https://a.example'])
    await expect(readCall(fail, { ...net, endpoints: ['https://a.example'], currentEndpoint: 0 } as never)).rejects.toThrow(/^Could not reach https:\/\/a\.example: the connection was refused\.$/)
  })

  function failure(code: string): Error {
    return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) })
  }
})
