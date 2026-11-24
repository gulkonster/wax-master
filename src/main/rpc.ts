// Chain and history API client. Runs in the main process with the built-in
// fetch. Every request has a timeout and a response size limit; responses are
// treated as untrusted data.

export const REQUEST_TIMEOUT_MS = 15_000
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed error body from the node, when it sent JSON. */
    readonly details?: unknown
  ) {
    super(message)
  }
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
}

/** Normalizes an endpoint URL: https only (http allowed for this computer), no path, no credentials. */
export function normalizeEndpoint(url: string): string {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new Error('Not a valid URL')
  }
  if (u.username || u.password) throw new Error('Endpoint URLs must not contain a user name or password')
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname))) {
    throw new Error('Use an https:// address (http:// is allowed only for this computer)')
  }
  return `${u.protocol}//${u.host}`
}

async function readLimited(res: Response): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? '0')
  if (len > MAX_RESPONSE_BYTES) throw new RpcError('Response too large', res.status)
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new RpcError('Response too large', res.status)
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.length
  }
  return new TextDecoder().decode(all)
}

/** Extracts the most useful message from a node error body. */
export function nodeErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback
  const b = body as { error?: { what?: string; details?: { message?: string }[] }; message?: string }
  const detail = b.error?.details?.find((d) => typeof d.message === 'string')?.message
  return detail || b.error?.what || b.message || fallback
}

/**
 * Codes of a connection that broke before any answer arrived. The built-in
 * fetch keeps sockets open between requests (keep-alive). A node, or the load
 * balancer in front of it, may close an idle socket without the client
 * noticing; the next request written to that socket fails at once with
 * "fetch failed" (cause: "other side closed", UND_ERR_SOCKET / ECONNRESET).
 * Requests in quick succession find a live socket and work, which is why the
 * first request after the app sat idle failed and an immediate repeat worked.
 */
const STALE_CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED'])

/** True when the error, or one of its causes, is a connection that broke before an answer came. */
export function isStaleConnection(e: unknown): boolean {
  let c: unknown = e
  for (let depth = 0; depth < 5 && c && typeof c === 'object'; depth++) {
    const code = (c as { code?: unknown }).code
    if (typeof code === 'string' && STALE_CONNECTION_CODES.has(code)) return true
    c = (c as { cause?: unknown }).cause
  }
  return false
}

export async function request<T>(
  endpoint: string,
  path: string,
  opts: {
    body?: unknown
    method?: 'GET' | 'POST'
    timeoutMs?: number
    /**
     * Send once more, on a new connection, when the first attempt failed on a
     * broken connection before any answer arrived (default true). Only the
     * fetch call itself is repeated, to the same URL: an answer whose body
     * fails to read is never sent again. Every chain read is safe to repeat;
     * for send_transaction see the note in signer.ts.
     */
    retryStale?: boolean
  } = {}
): Promise<T> {
  const url = normalizeEndpoint(endpoint) + path
  const controller = new AbortController()
  // One time limit covers both attempts.
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  try {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST')
    const init: RequestInit = {
      method,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit'
    }
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (e) {
      if (opts.retryStale === false || controller.signal.aborted || !isStaleConnection(e)) throw e
      // The broken socket has left the pool; this attempt opens a new connection.
      res = await fetch(url, init)
    }
    const text = await readLimited(res)
    let json: unknown
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      throw new RpcError(`Endpoint returned invalid JSON (HTTP ${res.status})`, res.status)
    }
    if (!res.ok) throw new RpcError(nodeErrorMessage(json, `HTTP ${res.status}`), res.status, json)
    return json as T
  } catch (e) {
    if (e instanceof RpcError) throw e
    if (controller.signal.aborted) throw new RpcError(`Request timed out after ${(opts.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000} s`, 0)
    throw new RpcError(e instanceof Error ? `Network error: ${e.message}` : 'Network error', 0)
  } finally {
    clearTimeout(timer)
  }
}

export interface ChainInfo {
  chain_id: string
  head_block_num: number
  head_block_id: string
  head_block_time: string
  last_irreversible_block_num: number
  last_irreversible_block_id: string
  server_version_string?: string
}

export const chain = {
  getInfo: (ep: string) => request<ChainInfo>(ep, '/v1/chain/get_info', { body: {} }),
  getAccount: (ep: string, account: string) => request<Record<string, unknown>>(ep, '/v1/chain/get_account', { body: { account_name: account } }),
  getAbi: (ep: string, account: string) => request<{ account_name: string; abi?: unknown }>(ep, '/v1/chain/get_abi', { body: { account_name: account } }),
  getRawAbi: (ep: string, account: string) =>
    request<{ account_name: string; code_hash: string; abi_hash: string; abi: string }>(ep, '/v1/chain/get_raw_abi', { body: { account_name: account } }),
  getCodeHash: (ep: string, account: string) => request<{ account_name: string; code_hash: string }>(ep, '/v1/chain/get_code_hash', { body: { account_name: account } }),
  getCurrencyBalance: (ep: string, code: string, account: string, symbol?: string) =>
    request<string[]>(ep, '/v1/chain/get_currency_balance', { body: { code, account, symbol } }),
  getTableRows: (ep: string, body: Record<string, unknown>) => request<{ rows: unknown[]; more: boolean; next_key?: string }>(ep, '/v1/chain/get_table_rows', { body }),
  getTableByScope: (ep: string, body: Record<string, unknown>) =>
    request<{ rows: { code: string; scope: string; table: string; payer: string; count: number }[]; more: string }>(ep, '/v1/chain/get_table_by_scope', { body }),
  getBlockInfo: (ep: string, blockNum: number) => request<Record<string, unknown>>(ep, '/v1/chain/get_block_info', { body: { block_num: blockNum } }),
  getActivatedProtocolFeatures: (ep: string) =>
    request<{ activated_protocol_features: { feature_digest: string; specification?: { name: string; value: string }[] }[]; more?: number }>(
      ep,
      '/v1/chain/get_activated_protocol_features',
      { body: { limit: 100, search_by_block_num: false, reverse: false } }
    ),
  getAccountsByAuthorizers: (ep: string, keys: string[]) =>
    request<{ accounts: { account_name: string; permission_name: string; authorizing_key?: string; weight: number; threshold: number }[] }>(
      ep,
      '/v1/chain/get_accounts_by_authorizers',
      { body: { keys, accounts: [] } }
    )
}

export const history = {
  getActions: (hist: string, account: string, skip: number, limit: number) =>
    request<{ actions?: HistoryAction[]; total?: { value: number } }>(
      hist,
      `/v2/history/get_actions?account=${encodeURIComponent(account)}&skip=${skip}&limit=${limit}&sort=desc`
    ),
  getTransaction: (hist: string, id: string) =>
    request<Record<string, unknown>>(hist, `/v2/history/get_transaction?id=${encodeURIComponent(id)}`),
  health: (hist: string) => request<Record<string, unknown>>(hist, '/v2/health', { timeoutMs: 8000 })
}

export interface HistoryAction {
  '@timestamp'?: string
  timestamp?: string
  block_num?: number
  trx_id?: string
  act?: { account?: string; name?: string; authorization?: { actor: string; permission: string }[]; data?: unknown }
}
