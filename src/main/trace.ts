// Turns node traces (send_transaction / compute_transaction answers) and history
// API transactions into the inspector's tree. Everything is untrusted text;
// missing data stays null and is labelled in the window.

import type { AccountResources, InspectedTransaction, RamShortage, ResourceKind, ResourceProblem, TraceNode } from '../shared/trace-types'

type R = Record<string, unknown>

const MAX_TEXT = 200_000

function s(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function n(v: unknown): number | null {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(x) ? x : null
}
function cap(t: string): string {
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t
}
function json(v: unknown): string | null {
  if (v === undefined) return null
  try {
    return cap(JSON.stringify(v, null, 2))
  } catch {
    return null
  }
}
function auths(v: unknown): { actor: string; permission: string }[] {
  return Array.isArray(v) ? v.map((a: R) => ({ actor: s(a?.actor), permission: s(a?.permission) })) : []
}

/**
 * Lines the node adds after the real error (the console printed so far by the
 * running action). They never stand for the error itself.
 */
export function isContextLine(text: string): boolean {
  return /pending console output:/i.test(text)
}

/** Deepest useful message of a node exception (assertion text first). */
export function exceptMessage(except: unknown): { message: string | null; stack: string | null } {
  if (!except || typeof except !== 'object') return { message: null, stack: null }
  const e = except as R
  const stack = Array.isArray(e.stack) ? (e.stack as R[]) : []
  const formats = stack.map((x) => {
    const fmt = s(x.format)
    const data = (x.data ?? {}) as R
    return fmt.replace(/\$\{([a-z_]+)\}/gi, (_m, k: string) => (data[k] === undefined ? `\${${k}}` : String(data[k])))
  })
  const assertion = formats.map((f) => /assertion failure with message: (.*)/s.exec(f)?.[1]).find(Boolean)
  const message = assertion || formats.filter((f) => f.trim() && !isContextLine(f)).pop() || s(e.message) || s(e.name)
  return { message: message || null, stack: json(except) }
}

function nodeFromTrace(t: R): TraceNode {
  const act = (t.act ?? {}) as R
  const receipt = (t.receipt ?? {}) as R
  const receiver = s(t.receiver) || s(receipt.receiver)
  const err = t.except ? exceptMessage(t.except).message : null
  return {
    ordinal: n(t.action_ordinal) ?? 0,
    receiver,
    account: s(act.account),
    name: s(act.name),
    authorization: auths(act.authorization),
    data: act.data !== undefined && typeof act.data !== 'string' ? json(act.data) : null,
    hex: s(act.hex_data) || (typeof act.data === 'string' ? s(act.data) : '') || null,
    console: typeof t.console === 'string' ? cap(t.console) : null,
    ramDeltas: Array.isArray(t.account_ram_deltas)
      ? (t.account_ram_deltas as R[]).map((d) => ({ account: s(d.account), delta: n(d.delta) ?? 0 }))
      : null,
    returnValue: s(t.return_value_hex_data) || null,
    notification: !!receiver && receiver !== s(act.account),
    error: err,
    elapsedUs: n(t.elapsed),
    children: []
  }
}

/** Builds the tree from flat traces using creator_action_ordinal (falls back to inline_traces). */
export function buildTree(traces: R[]): TraceNode[] {
  if (traces.length === 0) return []
  if (traces.some((t) => t.action_ordinal !== undefined)) {
    const nodes = new Map<number, TraceNode>()
    const parentOf = new Map<number, number>()
    for (const t of traces) {
      const node = nodeFromTrace(t)
      nodes.set(node.ordinal, node)
      parentOf.set(node.ordinal, n(t.creator_action_ordinal) ?? 0)
    }
    const roots: TraceNode[] = []
    for (const [ord, node] of [...nodes.entries()].sort((a, b) => a[0] - b[0])) {
      const p = parentOf.get(ord) ?? 0
      const parent = p ? nodes.get(p) : undefined
      if (parent && parent !== node) parent.children.push(node)
      else roots.push(node)
    }
    return roots
  }
  const walk = (t: R): TraceNode => {
    const node = nodeFromTrace(t)
    node.children = Array.isArray(t.inline_traces) ? (t.inline_traces as R[]).map(walk) : []
    return node
  }
  return traces.map(walk)
}

function notesFor(nodes: TraceNode[]): string[] {
  const notes: string[] = []
  const all: TraceNode[] = []
  const walk = (x: TraceNode): void => {
    all.push(x)
    x.children.forEach(walk)
  }
  nodes.forEach(walk)
  if (all.length && all.every((x) => !x.console)) notes.push('Console output was not returned by this endpoint (or the contract printed nothing).')
  if (all.some((x) => x.data === null)) notes.push('Decoded input was not returned for some actions; the raw data is shown.')
  return notes
}

/** Answer of send_transaction or compute_transaction. */
export function fromNodeAnswer(answer: unknown, ctx: { source: 'simulation' | 'sent'; network: string; endpoint: string }): InspectedTransaction {
  const a = (answer ?? {}) as R
  const p = (a.processed ?? {}) as R
  const receipt = (p.receipt ?? {}) as R
  const traces = Array.isArray(p.action_traces) ? (p.action_traces as R[]) : []
  const actions = buildTree(traces)
  const ex = exceptMessage(p.except)
  const failedNode = findError(actions)
  const resource = p.except && typeof p.except === 'object' ? resourceKindOf(p.except as R) : null
  return {
    source: ctx.source,
    network: ctx.network,
    endpoint: ctx.endpoint,
    id: s(a.transaction_id) || s(p.id),
    block: n(p.block_num),
    time: s(p.block_time) || null,
    status: ex.message || failedNode ? 'failed' : s(receipt.status) || 'executed',
    cpuUs: n(receipt.cpu_usage_us),
    netBytes: (n(receipt.net_usage_words) ?? 0) * 8 || n(p.net_usage),
    errorMessage: resource ? describeResource(resource.kind, '', null, resource.shortage) : (ex.message ?? failedNode),
    errorStack: ex.stack,
    actions,
    notes: notesFor(actions),
    ...(resource ? { resource: resourceProblem(resource) } : {})
  }
}

// ---- CPU / NET / RAM refusals ----

const CPU_ERRORS = new Set(['tx_cpu_usage_exceeded', 'leeway_deadline_exception', 'greylist_cpu_usage_exceeded'])
const NET_ERRORS = new Set(['tx_net_usage_exceeded', 'greylist_net_usage_exceeded'])
const RAM_ERRORS = new Set(['ram_usage_exceeded'])

/**
 * Which resource a node error (error object of a send_transaction answer, or
 * the except of a trace) names. Only the node's own error names count; a
 * timeout or a network error never reaches here as a resource problem.
 */
export function resourceKindOf(err: R): { kind: ResourceKind; name: string; shortage: RamShortage | null } | null {
  const name = s(err.name)
  let text = ''
  try {
    text = JSON.stringify(err).slice(0, 20_000)
  } catch {
    text = ''
  }
  let kind: ResourceKind | null = null
  if (CPU_ERRORS.has(name)) kind = 'cpu'
  else if (NET_ERRORS.has(name)) kind = 'net'
  else if (RAM_ERRORS.has(name)) kind = 'ram'
  // deadline_exception counts only when it comes from CPU billing.
  else if (name === 'deadline_exception' && /billing_timer|deadline exceeded/i.test(text)) kind = 'cpu'
  if (!kind) return null
  return { kind, name, shortage: kind === 'ram' ? ramShortage(err) : null }
}

function resourceProblem(r: { kind: ResourceKind; name: string; shortage: RamShortage | null }): ResourceProblem {
  return { kind: r.kind, errorName: r.name, account: '', state: null, ...(r.shortage ? { shortage: r.shortage } : {}) }
}

const NAME = /^[a-z1-5.]{1,13}$/

/**
 * The account a RAM refusal names and the bytes it needs and has, read from the
 * error's data (an except stack) or from the node's formatted text (error details).
 */
export function ramShortage(err: R): RamShortage | null {
  const stack = Array.isArray(err.stack) ? (err.stack as R[]) : []
  for (const x of stack) {
    if (!/insufficient ram/i.test(s(x.format))) continue
    const data = (x.data ?? {}) as R
    const account = s(data.account)
    if (NAME.test(account)) return { account, needs: n(data.needs), has: n(data.available) }
  }
  const details = Array.isArray(err.details) ? (err.details as R[]) : []
  for (const text of [...details.map((d) => s(d.message)), s(err.message), s(err.what)]) {
    const m = /account ([a-z1-5.]{1,13}) has insufficient ram(?:; needs (\d+) bytes has (\d+) bytes)?/i.exec(text)
    if (m) return { account: m[1], needs: m[2] ? Number(m[2]) : null, has: m[3] ? Number(m[3]) : null }
  }
  return null
}

/** CPU, NET and RAM of an account from a get_account answer. */
export function resourcesFromAccount(account: string, a: R): AccountResources {
  const lim = (v: unknown): AccountResources['cpu'] => {
    if (!v || typeof v !== 'object') return null
    const o = v as R
    const used = n(o.used)
    const available = n(o.available)
    const max = n(o.max)
    return used === null || available === null || max === null ? null : { used, available, max }
  }
  const ramUsed = n(a.ram_usage)
  const ramQuota = n(a.ram_quota)
  return {
    account,
    cpu: lim(a.cpu_limit),
    net: lim(a.net_limit),
    ram: ramUsed === null || ramQuota === null ? null : { used: ramUsed, quota: ramQuota }
  }
}

function fmtUs(us: number): string {
  if (us < 0) return 'unlimited'
  return us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${us} µs`
}
function fmtBytes(b: number): string {
  if (b < 0) return 'unlimited'
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(2)} KB`
  return `${b} bytes`
}

/** One short summary of an account's resources, the resource in question first. */
export function resourceSummary(kind: ResourceKind, st: AccountResources): string {
  const parts: Record<ResourceKind, string | null> = {
    cpu: st.cpu ? `CPU ${fmtUs(st.cpu.used)} used, ${fmtUs(st.cpu.available)} available` : null,
    net: st.net ? `NET ${fmtBytes(st.net.used)} used, ${fmtBytes(st.net.available)} available` : null,
    ram: st.ram ? `RAM ${fmtBytes(st.ram.used)} used of ${fmtBytes(st.ram.quota)}` : null
  }
  const order: ResourceKind[] = [kind, ...(['cpu', 'net', 'ram'] as ResourceKind[]).filter((k) => k !== kind)]
  return order
    .map((k) => parts[k])
    .filter(Boolean)
    .join('; ')
}

const WHAT: Record<ResourceKind, string> = {
  cpu: 'enough CPU time',
  net: 'enough network bandwidth (NET)',
  ram: 'enough RAM'
}

/** The plain sentence for a CPU / NET / RAM refusal, with the account's state when it is known. */
/**
 * The plain sentence for a CPU / NET / RAM refusal. `account` is the account whose
 * resources `state` holds; a RAM refusal names the account the node names.
 */
export function describeResource(
  kind: ResourceKind,
  account: string,
  state: AccountResources | null | 'unreadable',
  shortage: RamShortage | null = null
): string {
  const who = shortage?.account || account || 'the account'
  const head = `Rejected for ${kind.toUpperCase()}: ${who} does not have ${WHAT[kind]} for this transaction`
  const need =
    shortage && shortage.needs !== null && shortage.has !== null ? `needs ${shortage.needs.toLocaleString('en-US')} bytes, has ${shortage.has.toLocaleString('en-US')} bytes` : null
  // Resources of another account than the one named are never shown as if they were its own.
  const own = !shortage || shortage.account === account
  const sum = state && state !== 'unreadable' && own ? resourceSummary(kind, state) : ''
  const parts = [need, sum ? `${account}: ${sum}` : null, state === 'unreadable' && own && !need ? `the resources of ${account} could not be read` : null].filter(Boolean)
  return parts.length ? `${head} (${parts.join('; ')}).` : `${head}.`
}

/**
 * For a CPU / NET / RAM refusal: reads the resources of the account the node
 * names (a RAM refusal) or else of the first authorizer (from the same endpoint,
 * through `read`) and puts them into the trace and its error sentence. Other
 * traces are returned unchanged.
 */
export async function withResourceState(t: InspectedTransaction, signer: string, read: (account: string) => Promise<R>): Promise<InspectedTransaction> {
  if (!t.resource) return t
  const shortage = t.resource.shortage ?? null
  const account = shortage?.account || signer
  let state: AccountResources | null = null
  if (account) {
    try {
      state = resourcesFromAccount(account, await read(account))
    } catch {
      state = null
    }
  }
  const resource: ResourceProblem = { ...t.resource, account, state }
  return { ...t, resource, errorMessage: describeResource(resource.kind, account, account ? (state ?? 'unreadable') : null, shortage) }
}

/**
 * The error line of a send the node refused: a CPU / NET / RAM refusal in plain words;
 * anything else the node's message without the words "assertion failure with message: ",
 * so every form says a contract's check as the inspector does.
 */
export function failedSendError(trace: InspectedTransaction | null, error: string | undefined): string {
  if (trace?.resource) return trace.errorMessage ?? error ?? 'Failed'
  return (error ?? 'Failed').replace('assertion failure with message: ', '')
}

/** Error answer of a node (HTTP 500 body), e.g. a failed check in a contract. */
export function fromNodeError(body: unknown, ctx: { source: 'simulation' | 'sent'; network: string; endpoint: string }, id = ''): InspectedTransaction {
  const b = (body ?? {}) as R
  const err = (b.error ?? {}) as R
  const details = Array.isArray(err.details) ? (err.details as R[]) : []
  const assertion = details.map((d) => /assertion failure with message: (.*)/s.exec(s(d.message))?.[1]).find(Boolean)
  const message =
    assertion ||
    details.map((d) => s(d.message)).filter((m) => m.trim() && !isContextLine(m))[0] ||
    s(err.what) ||
    s(b.message) ||
    'The node refused the transaction'
  const resource = resourceKindOf(err)
  return {
    ...(resource ? { resource: resourceProblem(resource) } : {}),
    source: ctx.source,
    network: ctx.network,
    endpoint: ctx.endpoint,
    id,
    block: null,
    time: null,
    status: 'failed',
    cpuUs: null,
    netBytes: null,
    errorMessage: resource ? describeResource(resource.kind, '', null, resource.shortage) : message,
    errorStack: json(body),
    actions: [],
    notes: ['The node returned an error before any action trace.']
  }
}

/** Hyperion v2 get_transaction answer. */
export function fromHistory(answer: unknown, ctx: { network: string; endpoint: string }): InspectedTransaction {
  const a = (answer ?? {}) as R
  const list = Array.isArray(a.actions) ? (a.actions as R[]) : []
  const traces = list.map((x) => ({
    action_ordinal: x.action_ordinal,
    creator_action_ordinal: x.creator_action_ordinal,
    receiver: Array.isArray(x.receipts) && x.receipts[0] ? (x.receipts[0] as R).receiver : x.receiver,
    act: x.act,
    console: x.console,
    account_ram_deltas: x.account_ram_deltas
  }))
  const actions = buildTree(traces as R[])
  const first = list[0] ?? {}
  return {
    source: 'history',
    network: ctx.network,
    endpoint: ctx.endpoint,
    id: s(a.trx_id) || s(first.trx_id),
    block: n(first.block_num),
    time: s(first['@timestamp']) || s(first.timestamp) || null,
    status: a.executed === false ? 'failed' : 'executed',
    cpuUs: n(first.cpu_usage_us),
    netBytes: (n(first.net_usage_words) ?? 0) * 8 || null,
    errorMessage: null,
    errorStack: null,
    actions,
    notes: [...notesFor(actions), 'Read from the history service.']
  }
}

function findError(nodes: TraceNode[]): string | null {
  for (const x of nodes) {
    if (x.error) return x.error
    const c = findError(x.children)
    if (c) return c
  }
  return null
}
