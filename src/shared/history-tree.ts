// Builds the transaction tree from a history service answer (Hyperion v2
// get_transaction). The service gives one entry per distinct action: all
// receivers of an action are receipts of one entry, and identical actions are
// joined into one entry. The entries are taken apart again into one node per
// receipt and placed by the service's own links (action ordinals) first, and
// by the order of execution (global sequence) where a link is missing.
// Pure: no network, no Electron. Everything read is untrusted text.

import type { TraceNode } from './trace-types'

type R = Record<string, unknown>

const MAX_TEXT = 200_000

export interface HistoryTree {
  roots: TraceNode[]
  /** Nodes placed by the order of execution, not by a link from the service. */
  placedByOrder: number
  /** True when the service joined identical actions into one entry. */
  joined: boolean
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function n(v: unknown): number | null {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(x) ? x : null
}
/** A global sequence as text (the services give a number or a string). */
function seqText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v)
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim().replace(/^0+(?=\d)/, '')
  return null
}
function seqValue(t: string | null): bigint | null {
  return t === null ? null : BigInt(t)
}
function json(v: unknown): string | null {
  if (v === undefined) return null
  try {
    const t = JSON.stringify(v, null, 2)
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t
  } catch {
    return null
  }
}
function auths(v: unknown): { actor: string; permission: string }[] {
  return Array.isArray(v) ? v.map((a: R) => ({ actor: s(a?.actor), permission: s(a?.permission) })) : []
}
function ramOf(v: unknown): { account: string; delta: number }[] | null {
  return Array.isArray(v) ? (v as R[]).map((d) => ({ account: s(d?.account), delta: n(d?.delta) ?? 0 })) : null
}

/** One execution or notification taken from a receipt. */
interface Item {
  node: TraceNode
  seq: bigint | null
  /** Entry's action ordinal; only the first execution of an entry has it. */
  ordinal: number | null
  creator: number | null
  /** The entry's creator ordinal, also for its joined executions. */
  entryCreator: number | null
  actors: string[]
  isNotification: boolean
  /** Index in the order the items were made (a tie breaker). */
  index: number
  parent: Item | null
}

function compareItems(a: Item, b: Item): number {
  if (a.seq !== null && b.seq !== null && a.seq !== b.seq) return a.seq < b.seq ? -1 : 1
  if (a.seq !== null && b.seq === null) return -1
  if (a.seq === null && b.seq !== null) return 1
  const oa = a.node.ordinal || Number.MAX_SAFE_INTEGER
  const ob = b.node.ordinal || Number.MAX_SAFE_INTEGER
  return oa !== ob ? oa - ob : a.index - b.index
}

/** The traces of a v1 answer, or the list itself. */
function v1Traces(v1: unknown): R[] {
  if (Array.isArray(v1)) return v1 as R[]
  if (v1 && typeof v1 === 'object' && Array.isArray((v1 as R).traces)) return (v1 as R).traces as R[]
  return []
}

/**
 * The tree of a history answer. `v1` (optional) is the same transaction's
 * v1 get_transaction answer or its `traces`: each node then gets the RAM
 * changes of the v1 trace with the same global sequence. `signedActions`
 * (optional) is the number of actions of the signed transaction
 * (context-free actions and actions, from the transaction in its block).
 */
export function historyTree(answer: unknown, v1?: unknown, signedActions?: number): HistoryTree {
  const a = (answer ?? {}) as R
  const entries = Array.isArray(a.actions) ? (a.actions as R[]) : []
  const items: Item[] = []
  const usedKeys = new Set<string>()
  let joined = false

  const make = (entry: R, ei: number, ri: number, receiver: string, seq: string | null, ordinal: number | null): TraceNode => {
    const act = (entry.act ?? {}) as R
    let key = seq ?? (ordinal !== null ? `o${ordinal}` : `h${ei}.${ri}`)
    if (usedKeys.has(key)) key = `h${ei}.${ri}`
    usedKeys.add(key)
    const notification = !!receiver && receiver !== s(act.account)
    return {
      key,
      kind: notification ? 'notification' : 'action',
      sequence: seq,
      placed: 'top',
      ordinal: ordinal ?? 0,
      receiver,
      account: s(act.account),
      name: s(act.name),
      authorization: auths(act.authorization),
      data: act.data !== undefined && typeof act.data !== 'string' ? json(act.data) : null,
      hex: s(act.hex_data) || (typeof act.data === 'string' ? s(act.data) : '') || null,
      // The history service keeps no console output.
      console: null,
      ramDeltas: null,
      returnValue: null,
      notification,
      error: null,
      elapsedUs: null,
      children: []
    }
  }

  entries.forEach((entry, ei) => {
    const act = (entry.act ?? {}) as R
    const contract = s(act.account)
    const receiptList = Array.isArray(entry.receipts) && entry.receipts.length ? (entry.receipts as R[]) : [{ receiver: s(entry.receiver) || contract, global_sequence: entry.global_sequence }]
    const receipts = receiptList
      .map((r, i) => ({ receiver: s(r?.receiver), seq: seqText(r?.global_sequence), i }))
      .sort((x, y) => {
        const sx = seqValue(x.seq)
        const sy = seqValue(y.seq)
        if (sx !== null && sy !== null && sx !== sy) return sx < sy ? -1 : 1
        return x.i - y.i
      })
    const entryOrdinal = n(entry.action_ordinal)
    const entryCreator = n(entry.creator_action_ordinal)
    const actors = auths(act.authorization).map((x) => x.actor)
    let current: Item | null = null
    let firstExec: Item | null = null
    let executions = 0
    for (const [ri, r] of receipts.entries()) {
      const starts = r.receiver === contract
      const first = starts && executions === 0
      const ordinal = first ? entryOrdinal : null
      const item: Item = {
        node: make(entry, ei, ri, r.receiver, r.seq, ordinal),
        seq: seqValue(r.seq),
        ordinal,
        creator: first ? entryCreator : null,
        entryCreator,
        actors,
        isNotification: !starts,
        index: items.length,
        parent: null
      }
      if (starts) {
        executions++
        current = item
        if (first) firstExec = item
      } else if (current) {
        // A notification of the execution before it in the same entry.
        item.parent = current
        item.node.placed = 'link'
      }
      items.push(item)
    }
    if (executions > 1) joined = true
    // An entry's RAM changes go to its first execution (the v1 answer replaces them below).
    const deltas = ramOf(entry.account_ram_deltas)
    if (deltas && firstExec) firstExec.node.ramDeltas = deltas
  })

  let placedByOrder = 0

  // Executions of entries with creator 0 are the actions of the transaction: the
  // chain runs them first and in their signed order, each one whole, so the k-th
  // by global sequence has the ordinal k. A joined copy (no ordinal of its own)
  // gets that ordinal when the numbers agree; else it stays at the top unranked.
  const tops = items.filter((x) => !x.isNotification && x.entryCreator === 0).sort(compareItems)
  const settled = new Set<Item>()
  if (tops.some((x) => x.ordinal === null)) {
    const ranked =
      tops.every((x, i) => x.ordinal === null || x.ordinal === i + 1) &&
      !items.some((x) => x.entryCreator !== null && x.entryCreator > 0 && x.ordinal !== null && x.ordinal <= tops.length) &&
      (signedActions === undefined || signedActions === tops.length)
    tops.forEach((x, i) => {
      if (x.ordinal !== null) return
      settled.add(x)
      x.parent = null
      if (ranked) {
        x.ordinal = i + 1
        x.node.ordinal = i + 1
        x.creator = 0
        x.node.placed = signedActions !== undefined ? 'top' : 'order'
      } else x.node.placed = 'order'
      if (x.node.placed === 'order') placedByOrder++
    })
  }

  const byOrdinal = new Map<number, Item>()
  for (const x of items) if (x.ordinal !== null && x.ordinal > 0 && !byOrdinal.has(x.ordinal)) byOrdinal.set(x.ordinal, x)

  const sorted = [...items].sort(compareItems)
  for (const x of items) {
    if (x.parent || settled.has(x)) continue
    if (!x.isNotification && x.creator === 0) {
      x.node.placed = 'top'
      continue
    }
    const linked = !x.isNotification && x.creator !== null ? byOrdinal.get(x.creator) : undefined
    if (linked && linked !== x) {
      x.parent = linked
      x.node.placed = 'link'
      continue
    }
    // By order: the latest earlier trace received by one of the actors. When the
    // creator is an ordinal no entry has, the creator is a trace without an
    // ordinal of its own (a notification or a joined action).
    const missingCreator = !x.isNotification && x.creator !== null && x.creator > 0
    let found: Item | null = null
    if (x.seq !== null) {
      for (const c of sorted) {
        if (c === x || c.seq === null || c.seq >= x.seq) continue
        if (!x.actors.includes(c.node.receiver)) continue
        if (missingCreator && c.ordinal !== null) continue
        found = c
      }
    }
    x.parent = found
    x.node.placed = 'order'
    placedByOrder++
  }

  // A link that closes a circle is dropped: that node goes to the top.
  for (const x of items) {
    const seen = new Set<Item>([x])
    for (let p = x.parent; p; p = p.parent) {
      if (seen.has(p)) {
        x.parent = null
        if (x.node.placed === 'link') x.node.placed = 'top'
        break
      }
      seen.add(p)
    }
  }

  for (const x of items) {
    if (x.isNotification) continue
    x.node.kind = x.parent || (x.entryCreator !== null && x.entryCreator > 0) ? 'inline' : 'action'
  }

  if (v1 !== undefined) {
    const bySeq = new Map<string, R>()
    for (const t of v1Traces(v1)) {
      const seq = seqText(((t?.receipt ?? {}) as R).global_sequence)
      if (seq !== null && !bySeq.has(seq)) bySeq.set(seq, t)
    }
    if (bySeq.size) {
      for (const x of items) {
        const t = x.node.sequence !== null ? bySeq.get(x.node.sequence) : undefined
        x.node.ramDeltas = t ? ramOf(t.account_ram_deltas) : null
      }
    }
  }

  const roots: Item[] = []
  const kids = new Map<Item, Item[]>()
  for (const x of sorted) {
    if (x.parent) {
      const list = kids.get(x.parent) ?? []
      list.push(x)
      kids.set(x.parent, list)
    } else roots.push(x)
  }
  for (const [p, list] of kids) p.node.children = list.map((c) => c.node)
  return { roots: roots.map((x) => x.node), placedByOrder, joined }
}
