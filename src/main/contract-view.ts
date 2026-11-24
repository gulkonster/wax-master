// Contract page support: ABI summary, action packing, table queries, and the
// favorites and history store. Chain data is untrusted: it is validated and
// size-limited here and passed on as plain data.

import { randomUUID } from 'node:crypto'
import { bytesToHex, encodeAction, parseAbi, type AbiDef } from '../chain-core'
import type {
  AuthLevel,
  ContractAbiView,
  ContractField,
  ContractHistoryEntry,
  ContractHistoryKind,
  ContractHistoryList,
  NetworkInfo,
  PackResult,
  RowsQuery,
  RowsResult
} from '../shared/chain-types'
import { readJson, writeJson } from './jsonfile'
import { chain } from './rpc'

const MAX_ACTIONS = 2000
const MAX_TABLES = 500
const MAX_FIELDS = 500
const MAX_BASE_DEPTH = 32
export const HISTORY_CAP = 50
export const FAVORITES_CAP = 200

// ------------------------------------------------------------------ ABI

interface CacheEntry {
  def: AbiDef | null
  view: ContractAbiView
}
const abiCache = new Map<string, CacheEntry>()

function resolveAlias(def: AbiDef, type: string): string {
  let t = type
  for (let i = 0; i < MAX_BASE_DEPTH; i++) {
    const a = def.types.find((x) => x.new_type_name === t)
    if (!a) return t
    t = a.type
  }
  return t
}

/** Resolves aliases under the `[]`, `?` and `$` markers. */
function resolveSuffixed(def: AbiDef, type: string, depth = 0): string {
  const m = /^(.*?)(\[\]|\?|\$)?$/.exec(type)
  const inner = m ? m[1] : type
  const suffix = m?.[2] ?? ''
  const base = resolveAlias(def, inner)
  if (depth < MAX_BASE_DEPTH && /(\[\]|\?|\$)$/.test(base)) return resolveSuffixed(def, base, depth + 1) + suffix
  return base + suffix
}

/** Fields of a struct including those of its base structs (base first). */
export function structFields(def: AbiDef, structName: string): ContractField[] {
  const chainOfStructs: AbiDef['structs'] = []
  let name = resolveAlias(def, structName)
  const seen = new Set<string>()
  for (let i = 0; i < MAX_BASE_DEPTH && name; i++) {
    if (seen.has(name)) break
    seen.add(name)
    const s = def.structs.find((x) => x.name === name)
    if (!s) break
    chainOfStructs.unshift(s)
    name = s.base ? resolveAlias(def, s.base) : ''
  }
  const out: ContractField[] = []
  for (const s of chainOfStructs) {
    for (const f of s.fields) {
      if (out.length >= MAX_FIELDS) return out
      out.push({ name: f.name, type: f.type, resolved: resolveSuffixed(def, f.type) })
    }
  }
  return out
}

export function abiView(account: string, def: AbiDef): ContractAbiView {
  return {
    hasAbi: true,
    account,
    actions: def.actions.slice(0, MAX_ACTIONS).map((a) => ({
      name: a.name,
      type: a.type,
      ricardian: a.ricardian_contract,
      fields: structFields(def, a.type)
    })),
    tables: def.tables.slice(0, MAX_TABLES).map((t) => ({
      name: t.name,
      type: t.type,
      indexType: t.index_type,
      keyNames: t.key_names,
      keyTypes: t.key_types,
      fields: structFields(def, t.type)
    }))
  }
}

export type ReadCall = <T>(fn: (endpoint: string) => Promise<T>, network?: NetworkInfo) => Promise<T>

async function loadAbi(n: NetworkInfo, account: string, readCall: ReadCall, refresh: boolean): Promise<CacheEntry> {
  const key = `${n.id}:${account}`
  const hit = abiCache.get(key)
  if (hit && !refresh) return hit
  const r = await readCall((ep) => chain.getAbi(ep, account), n)
  let entry: CacheEntry
  if (!r.abi) {
    entry = { def: null, view: { hasAbi: false, account, actions: [], tables: [] } }
  } else {
    const def = parseAbi(JSON.stringify(r.abi)) // 2 MB limit and shape check
    entry = { def, view: abiView(account, def) }
  }
  abiCache.set(key, entry)
  return entry
}

export async function getContractAbi(n: NetworkInfo, account: string, readCall: ReadCall, refresh = false): Promise<ContractAbiView> {
  return (await loadAbi(n, account, readCall, refresh)).view
}

export async function getContractDef(n: NetworkInfo, account: string, readCall: ReadCall): Promise<AbiDef> {
  const e = await loadAbi(n, account, readCall, false)
  if (!e.def) throw new Error(`${account} has no contract (no ABI) on ${n.name}`)
  return e.def
}

// ------------------------------------------------------------------ pack

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Packs action data with the chain core and builds the JSON, hex and cleos forms. */
export function packAction(def: AbiDef, endpoint: string, account: string, action: string, data: unknown, authorization: AuthLevel[]): PackResult {
  const bytes = encodeAction(def, action, data)
  const dataJson = JSON.stringify(data)
  const json = JSON.stringify({ account, name: action, authorization, data }, null, 2)
  const perms = authorization.map((a) => `-p ${a.actor}@${a.permission}`).join(' ')
  const cleos = `cleos -u ${endpoint} push action ${account} ${action} ${shellQuote(dataJson)}${perms ? ' ' + perms : ''}`
  return { json, hex: bytesToHex(bytes), cleos }
}

// ------------------------------------------------------------------ tables

export const KEY_TYPES = ['i64', 'i128', 'i256', 'float64', 'float128', 'sha256', 'ripemd160', 'name'] as const

export function rowsBody(q: RowsQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {
    json: true,
    code: q.account,
    table: q.table,
    scope: q.scope || q.account,
    limit: q.limit,
    reverse: q.reverse
  }
  if (q.lower) body.lower_bound = q.lower
  if (q.upper) body.upper_bound = q.upper
  if (q.index) body.index_position = q.index
  if (q.keyType) body.key_type = q.keyType
  return body
}

export async function queryRows(n: NetworkInfo, q: RowsQuery, readCall: ReadCall): Promise<RowsResult> {
  const r = await readCall((ep) => chain.getTableRows(ep, rowsBody(q)), n)
  return { rows: Array.isArray(r.rows) ? r.rows : [], more: r.more === true, nextKey: typeof r.next_key === 'string' ? r.next_key : '' }
}

// ------------------------------------------------------------------ favorites and history

interface Bucket {
  favorite: ContractHistoryEntry[]
  history: ContractHistoryEntry[]
}
interface HistoryFile {
  version: 1
  /** key: `${networkId}|${contract}|${kind}` */
  items: Record<string, Bucket>
}

export class ContractHistory {
  constructor(private file: string) {}

  private load(): HistoryFile {
    const raw = readJson<Partial<HistoryFile>>(this.file, {})
    return { version: 1, items: typeof raw.items === 'object' && raw.items ? raw.items : {} }
  }

  private bucket(f: HistoryFile, network: string, account: string, kind: ContractHistoryKind): Bucket {
    const key = `${network}|${account}|${kind}`
    const b = f.items[key] ?? { favorite: [], history: [] }
    f.items[key] = {
      favorite: Array.isArray(b.favorite) ? b.favorite : [],
      history: Array.isArray(b.history) ? b.history : []
    }
    return f.items[key]
  }

  list(network: string, account: string, kind: ContractHistoryKind, list: ContractHistoryList): ContractHistoryEntry[] {
    return [...this.bucket(this.load(), network, account, kind)[list]]
  }

  add(network: string, account: string, kind: ContractHistoryKind, list: ContractHistoryList, name: string, payload: Record<string, unknown>): ContractHistoryEntry[] {
    const f = this.load()
    const b = this.bucket(f, network, account, kind)
    const same = JSON.stringify([name, payload])
    // The same entry moves to the top instead of repeating.
    const rest = b[list].filter((e) => JSON.stringify([e.name, e.payload]) !== same)
    const entry: ContractHistoryEntry = { id: randomUUID(), time: new Date().toISOString(), name, payload }
    b[list] = [entry, ...rest].slice(0, list === 'history' ? HISTORY_CAP : FAVORITES_CAP)
    writeJson(this.file, f)
    return [...b[list]]
  }

  remove(network: string, account: string, kind: ContractHistoryKind, list: ContractHistoryList, id: string): ContractHistoryEntry[] {
    const f = this.load()
    const b = this.bucket(f, network, account, kind)
    b[list] = b[list].filter((e) => e.id !== id)
    writeJson(this.file, f)
    return [...b[list]]
  }
}
