// Turns node traces (send_transaction / compute_transaction answers) and history
// API transactions into the inspector's tree. Everything is untrusted text;
// missing data stays null and is labelled in the window.

import type { InspectedTransaction, TraceNode } from '../shared/trace-types'

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
  const message = assertion ?? formats.filter(Boolean).pop() ?? s(e.message) ?? s(e.name) ?? null
  return { message: message || s(e.name) || null, stack: json(except) }
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
    errorMessage: ex.message ?? failedNode,
    errorStack: ex.stack,
    actions,
    notes: notesFor(actions)
  }
}

/** Error answer of a node (HTTP 500 body), e.g. a failed check in a contract. */
export function fromNodeError(body: unknown, ctx: { source: 'simulation' | 'sent'; network: string; endpoint: string }, id = ''): InspectedTransaction {
  const b = (body ?? {}) as R
  const err = (b.error ?? {}) as R
  const details = Array.isArray(err.details) ? (err.details as R[]) : []
  const assertion = details.map((d) => /assertion failure with message: (.*)/s.exec(s(d.message))?.[1]).find(Boolean)
  const message = assertion ?? details.map((d) => s(d.message)).filter(Boolean)[0] ?? s(err.what) ?? s(b.message) ?? 'The node refused the transaction'
  return {
    source: ctx.source,
    network: ctx.network,
    endpoint: ctx.endpoint,
    id,
    block: null,
    time: null,
    status: 'failed',
    cpuUs: null,
    netBytes: null,
    errorMessage: message,
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
