// Turns node traces (send_transaction / compute_transaction answers) and history
// API transactions into the inspector's tree. Everything is untrusted text;
// missing data stays null and is labelled in the window.

import { historyTree } from '../shared/history-tree'
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
  const ordinal = n(t.action_ordinal) ?? 0
  const creator = n(t.creator_action_ordinal) ?? 0
  const sequence = seqText(receipt.global_sequence)
  const notification = !!receiver && receiver !== s(act.account)
  return {
    key: sequence ?? `o${ordinal}`,
    kind: notification ? 'notification' : creator === 0 ? 'action' : 'inline',
    sequence,
    placed: creator === 0 ? 'top' : 'link',
    ordinal,
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
    notification,
    error: err,
    elapsedUs: n(t.elapsed),
    children: []
  }
}

/** A global sequence as text (nodes give a number or a string). */
function seqText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v)
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim().replace(/^0+(?=\d)/, '')
  return null
}

/** Order of execution: by global sequence (numeric), by ordinal where there is none. */
function byExecution(a: TraceNode, b: TraceNode): number {
  if (a.sequence !== null && b.sequence !== null) {
    const x = BigInt(a.sequence)
    const y = BigInt(b.sequence)
    if (x !== y) return x < y ? -1 : 1
  } else if (a.sequence !== null || b.sequence !== null) return a.sequence !== null ? -1 : 1
  return a.ordinal - b.ordinal
}

function sortByExecution(nodes: TraceNode[]): void {
  nodes.sort(byExecution)
  for (const x of nodes) sortByExecution(x.children)
}

/**
 * Builds the tree from flat traces using creator_action_ordinal (falls back to
 * inline_traces). A notification's creator is the action that notified it, so it
 * stays a child of that action. Children are in the order the chain ran them.
 */
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
      else {
        // A creator the answer does not hold: shown at the top.
        node.placed = 'top'
        roots.push(node)
      }
    }
    sortByExecution(roots)
    return roots
  }
  const walk = (t: R, depth: number): TraceNode => {
    const node = nodeFromTrace(t)
    if (!node.notification) node.kind = depth === 0 ? 'action' : 'inline'
    node.placed = depth === 0 ? 'top' : 'link'
    node.children = Array.isArray(t.inline_traces) ? (t.inline_traces as R[]).map((c) => walk(c, depth + 1)) : []
    return node
  }
  const roots = traces.map((t) => walk(t, 0))
  sortByExecution(roots)
  return roots
}

const MAX_RAW = 2_000_000

/**
 * An answer as received, as JSON with 2 spaces, cut at 2,000,000 characters
 * (the Raw tab says when a text was cut).
 */
export function rawText(v: unknown): string {
  let t: string
  try {
    t = JSON.stringify(v, null, 2) ?? String(v)
  } catch {
    t = String(v)
  }
  return t.length > MAX_RAW ? t.slice(0, MAX_RAW) : t
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
    raw: [{ title: 'Node answer', text: rawText(answer) }],
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
    notes: ['The node returned an error before any action trace.'],
    raw: [{ title: 'Node answer', text: rawText(body) }]
  }
}

/**
 * The first action of a history answer: the action of the transaction that ran
 * first (ordinal 1, else the lowest global sequence; the service lists its
 * entries in no fixed order).
 */
function firstEntry(list: R[]): R {
  const one = list.find((x) => n(x.action_ordinal) === 1 && n(x.creator_action_ordinal) === 0)
  if (one) return one
  let best: R | undefined
  let bestSeq: bigint | null = null
  for (const x of list) {
    const seq = seqText(x.global_sequence)
    if (seq === null) continue
    const v = BigInt(seq)
    if (bestSeq === null || v < bestSeq) {
      best = x
      bestSeq = v
    }
  }
  return best ?? list[0] ?? {}
}

/** Hyperion v2 get_transaction answer. */
export function fromHistory(answer: unknown, ctx: { network: string; endpoint: string }): InspectedTransaction {
  const a = (answer ?? {}) as R
  const list = Array.isArray(a.actions) ? (a.actions as R[]) : []
  const tree = historyTree(answer)
  const actions = tree.roots
  const first = firstEntry(list)
  // CPU and NET stand on the first action; another entry is read only when it has none there.
  const billed = n(first.cpu_usage_us) !== null ? first : (list.find((x) => n(x.cpu_usage_us) !== null) ?? first)
  const block = n(first.block_num)
  const lib = n(a.lib)
  const notes: string[] = []
  if (actions.length && hasNullData(actions)) notes.push('Decoded input was not returned for some actions; the raw data is shown.')
  notes.push('Read from the history service. It does not keep console output.')
  if (tree.placedByOrder > 0)
    notes.push(`${tree.placedByOrder} entries are placed by the order of execution, not by a link from the history service (marked "placed by order").`)
  if (tree.joined) notes.push('The history service joined identical actions; their RAM changes may be listed once.')
  return {
    source: 'history',
    network: ctx.network,
    endpoint: ctx.endpoint,
    id: s(a.trx_id) || s(first.trx_id),
    block,
    time: s(first['@timestamp']) || s(first.timestamp) || null,
    status: a.executed === false ? 'failed' : 'executed',
    cpuUs: n(billed.cpu_usage_us),
    netBytes: (n(billed.net_usage_words) ?? 0) * 8 || null,
    errorMessage: null,
    errorStack: null,
    actions,
    notes,
    raw: [{ title: 'History service answer', text: rawText(answer) }],
    ...(block !== null && lib !== null ? { finality: block <= lib ? ('irreversible' as const) : ('pending' as const) } : {})
  }
}

function hasNullData(nodes: TraceNode[]): boolean {
  return nodes.some((x) => x.data === null || hasNullData(x.children))
}

function findError(nodes: TraceNode[]): string | null {
  for (const x of nodes) {
    if (x.error) return x.error
    const c = findError(x.children)
    if (c) return c
  }
  return null
}
