// Pure helpers of the transaction view (Actions, Traces, RAM Deltas, Raw):
// counts, the flat list, RAM totals per account, the filter and the fixed
// sentences. No window, no network.

import type { InspectedTransaction, TraceNode } from './trace-types'

export const NOT_RETURNED = 'not returned by this endpoint'

/** Longest text the Raw tab shows of one answer. */
export const RAW_LIMIT = 2_000_000
export const RAW_CUT_LINE = 'Shown in part: the first 2,000,000 characters.'

export const TREE_LINE = 'Indented entries were caused by the entry above them.'
export const FILTER_PLACEHOLDER = 'Filter: contract, action or receiver'
export const NO_ACTION_TRACE = 'The node returned no action trace.'
export const NO_RAM_CHANGE = 'No RAM change was reported for this transaction.'
export const RAM_NOT_RETURNED = 'RAM changes were not returned by this endpoint.'
export const PLACED_BY_ORDER = 'placed by order'
export const PLACED_BY_ORDER_TIP = 'The history service did not say which action caused this one. It is shown under the nearest earlier action that could have sent it.'
export const HISTORY_CONSOLE = '(not kept by the history service)'
export const RAM_JOINED_NOTE = 'The history service joined identical actions; their RAM changes may be listed once.'

export type TabId = 'actions' | 'traces' | 'ram' | 'raw'
export const TAB_ORDER: readonly TabId[] = ['actions', 'traces', 'ram', 'raw']

/** Every node of the tree, each before its children, in the order shown. */
export function flatten(nodes: TraceNode[]): TraceNode[] {
  const out: TraceNode[] = []
  const walk = (n: TraceNode): void => {
    out.push(n)
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

export interface KindCounts {
  /** Actions of the transaction as it was signed. */
  actions: number
  inline: number
  notifications: number
  /** Every execution (the Traces count). */
  total: number
}

export function countKinds(nodes: TraceNode[]): KindCounts {
  const all = flatten(nodes)
  return {
    actions: all.filter((n) => n.kind === 'action').length,
    inline: all.filter((n) => n.kind === 'inline').length,
    notifications: all.filter((n) => n.kind === 'notification').length,
    total: all.length
  }
}

/** The actions of the transaction as it was signed, in order. */
export function signedActions(nodes: TraceNode[]): TraceNode[] {
  return flatten(nodes).filter((n) => n.kind === 'action')
}

/** The sentence under the Actions tab; null when the transaction caused nothing more. */
export function causedSentence(i: number, k: number): string | null {
  const parts: string[] = []
  if (i > 0) parts.push(i === 1 ? '1 inline action' : `${i} inline actions`)
  if (k > 0) parts.push(k === 1 ? '1 notification' : `${k} notifications`)
  if (parts.length === 0) return null
  return `This transaction caused ${parts.join(' and ')}. They are in Traces.`
}

export interface RamChange {
  account: string
  delta: number
  /** The trace the change happened in. */
  node: TraceNode
}

/** Every single RAM change, in the order of the tree. */
export function ramChanges(nodes: TraceNode[]): RamChange[] {
  const out: RamChange[] = []
  for (const n of flatten(nodes)) for (const d of n.ramDeltas ?? []) out.push({ account: d.account, delta: d.delta, node: n })
  return out
}

/** Sum of the RAM changes per account, in the order the accounts first appear. */
export function ramTotals(nodes: TraceNode[]): { account: string; delta: number }[] {
  const sums = new Map<string, number>()
  for (const c of ramChanges(nodes)) sums.set(c.account, (sums.get(c.account) ?? 0) + c.delta)
  return [...sums.entries()].map(([account, delta]) => ({ account, delta }))
}

/** True when no node carries RAM figures at all (not even an empty list). */
export function ramNotReturned(nodes: TraceNode[]): boolean {
  return flatten(nodes).every((n) => n.ramDeltas === null)
}

/** The empty-state sentence of RAM Deltas for this transaction. */
export function ramEmptyText(t: InspectedTransaction): string {
  return (t.source === 'history' || t.source === 'kept') && ramNotReturned(t.actions) ? RAM_NOT_RETURNED : NO_RAM_CHANGE
}

/** `+219 bytes` / `-219 bytes`. */
export function fmtRamDelta(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta} bytes`
}

/** `<contract>::<action>`, and the receiver when it is a notification. */
export function traceLabel(n: TraceNode): string {
  const base = `${n.account}::${n.name}`
  return n.kind === 'notification' ? `${base} (notification to ${n.receiver})` : base
}

/** Contract, action or receiver contain the text (any case); an empty filter matches every node. */
export function matchesFilter(node: TraceNode, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (!q) return true
  return [node.account, node.name, node.receiver, `${node.account}::${node.name}`].some((s) => s.toLowerCase().includes(q))
}

/** The first 100 characters of the decoded data (else the hex) on one line. */
export function dataLine(n: TraceNode, max = 100): string {
  let text = n.data ?? n.hex ?? ''
  if (n.data !== null) {
    try {
      text = JSON.stringify(JSON.parse(n.data))
    } catch {
      // not JSON: shown as it is, on one line
    }
  }
  text = text.replace(/\s*\n\s*/g, ' ')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Details start open for the actions of the transaction and for a failed node. */
export function detailsOpenAtStart(n: TraceNode): boolean {
  return n.kind === 'action' || n.error !== null
}

/** A raw answer as shown: cut at RAW_LIMIT, with the line when it was cut. */
export function rawShown(text: string): { text: string; cut: boolean } {
  if (text.length > RAW_LIMIT) return { text: text.slice(0, RAW_LIMIT), cut: true }
  // An answer already cut where it was read has exactly the limit's length.
  return { text, cut: text.length === RAW_LIMIT }
}

/** The labels of the four tabs. */
export function tabLabel(tab: TabId, t: InspectedTransaction): string {
  const c = countKinds(t.actions)
  if (tab === 'actions') return `Actions (${c.actions})`
  if (tab === 'traces') return `Traces (${c.total})`
  if (tab === 'ram') return `RAM Deltas (${ramChanges(t.actions).length})`
  return 'Raw'
}

/** The tab a left or right arrow moves to. */
export function nextTab(tab: TabId, key: string): TabId {
  const i = TAB_ORDER.indexOf(tab)
  if (key === 'ArrowRight') return TAB_ORDER[(i + 1) % TAB_ORDER.length]
  if (key === 'ArrowLeft') return TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length]
  return tab
}

export function finalityText(f: InspectedTransaction['finality']): string {
  if (f === 'irreversible') return 'irreversible'
  if (f === 'pending') return 'not yet irreversible'
  return `(${NOT_RETURNED})`
}

/** Host of an endpoint URL, else the text as it is. */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host || endpoint
  } catch {
    return endpoint
  }
}

/** The line under the head that says where an opened transaction comes from; null for a simulation or a send. */
export function sourceLine(t: InspectedTransaction, localTime: (s: string) => string): string | null {
  if (t.source === 'kept') return `From the answer the node gave when WAX Master sent it (${t.keptAt ? localTime(t.keptAt) : NOT_RETURNED}). It has the console output and every link between the actions.`
  if (t.source === 'history') return `Read from the history service ${hostOf(t.endpoint)}.`
  return null
}

/** Notes split by where they are shown: under the tree, in RAM Deltas, or under every tab. */
export function splitNotes(notes: string[]): { tree: string[]; ram: string[]; general: string[] } {
  const out = { tree: [] as string[], ram: [] as string[], general: [] as string[] }
  for (const n of notes) {
    if (n === RAM_JOINED_NOTE) out.ram.push(n)
    else if (/placed by the order of execution/.test(n)) out.tree.push(n)
    else out.general.push(n)
  }
  return out
}
