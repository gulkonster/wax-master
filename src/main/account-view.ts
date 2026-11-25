// Builds the Account page data from get_account and the history API.
// All chain data is untrusted: values are type-checked and passed on as text.

import type { AccountActionRow, AccountActionsFilter, AccountActionsPage, AccountView, PermissionView } from '../shared/chain-types'
import { actionsQuery, ACTIONS_PAGE, nextPagePassesWindow } from '../shared/history-filter'
import { chain, history } from './rpc'
import { plainAccountError } from './account-pick'
import { parsePublicKey, publicKeyToString } from '../chain-core'
import { currentNetwork, readCall, WAX_TESTNET_CHAIN } from './networks'
import { formatUnits, readAsset, rescaleUnits } from '../shared/wallet'

const MAX_DATA_TEXT = 4000

function toK1(key: string): string {
  try {
    return publicKeyToString(parsePublicKey(key), 'new')
  } catch {
    return ''
  }
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** "12.34500000 WAX" -> whole units at the network's precision (0 when it is not an asset of the symbol). */
function assetUnitsOf(a: string, precision: number, symbol: string): bigint {
  const x = readAsset(a)
  return x && x.symbol === symbol ? rescaleUnits(x.units, x.precision, precision) : 0n
}

function permissions(raw: unknown): PermissionView[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p: Record<string, unknown>) => {
    const auth = (p.required_auth ?? {}) as Record<string, unknown>
    return {
      name: str(p.perm_name),
      parent: str(p.parent),
      threshold: num(auth.threshold),
      keys: Array.isArray(auth.keys) ? auth.keys.map((k: Record<string, unknown>) => ({ key: str(k.key), k1: toK1(str(k.key)), weight: num(k.weight) })) : [],
      accounts: Array.isArray(auth.accounts)
        ? auth.accounts.map((a: Record<string, unknown>) => {
            const perm = (a.permission ?? {}) as Record<string, unknown>
            return { actor: str(perm.actor), permission: str(perm.permission), weight: num(a.weight) }
          })
        : [],
      waits: Array.isArray(auth.waits) ? auth.waits.map((w: Record<string, unknown>) => ({ waitSec: num(w.wait_sec), weight: num(w.weight) })) : []
    }
  })
}

/**
 * Refund delay: unstaked tokens can be claimed 3 days after the request. The
 * number is `refund_delay_sec`, a constant compiled into the system contract
 * (eosio.system); it is in no table and no API answer, so it cannot be read from
 * the chain. It is exact on the WAX chains; elsewhere it is the standard value.
 */
export const REFUND_DELAY_SEC = 3 * 24 * 3600

/** Chain ids whose refund waiting time is known to be REFUND_DELAY_SEC: WAX Mainnet and WAX Testnet. */
export const WAX_CHAIN_IDS: readonly string[] = ['1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4', WAX_TESTNET_CHAIN]

/** Seconds from the chain's head time to the refund's due time (zero or below when due); null when a time is missing. */
export function refundSecondsLeft(requestTime: string, headTime: string): number | null {
  const due = chainTimePlus(requestTime, REFUND_DELAY_SEC)
  const head = chainTimePlus(headTime, 0)
  if (!due || !head) return null
  return Math.ceil((new Date(due).getTime() - new Date(head).getTime()) / 1000)
}

/** Permissions are listed in this order: active, owner, then the others by name. */
function permOrder(a: string, b: string): number {
  const rank = (p: string): number => (p === 'active' ? 0 : p === 'owner' ? 1 : 2)
  return rank(a) - rank(b) || a.localeCompare(b)
}

/**
 * Permissions whose threshold the vault's keys reach with their own weights.
 * Only keys count (an account entry or a wait is not something the vault holds);
 * each key counts once; a threshold of zero or less is never "controlled".
 */
export function controlledPermissions(perms: PermissionView[], vaultKeys: readonly string[]): string[] {
  const mine = new Set(vaultKeys.map(toK1).filter((k) => k !== ''))
  const out: string[] = []
  for (const p of perms) {
    if (!p.name || !(p.threshold > 0)) continue
    const seen = new Set<string>()
    let weight = 0
    for (const k of p.keys) {
      const k1 = k.k1 || toK1(k.key)
      if (!k1 || seen.has(k1) || !mine.has(k1)) continue
      seen.add(k1)
      weight += k.weight > 0 ? k.weight : 0
    }
    if (weight >= p.threshold) out.push(p.name)
  }
  return [...new Set(out)].sort(permOrder)
}

/** Chain time ("2026-11-24T10:00:00.000", UTC without a zone) plus seconds, as ISO text; '' when not a time. */
export function chainTimePlus(t: string, seconds: number): string {
  if (!t) return ''
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + seconds * 1000).toISOString()
}

export async function accountView(name: string, vaultKeys: readonly string[] = []): Promise<AccountView> {
  const n = currentNetwork()
  const a = await readCall((ep) => chain.getAccount(ep, name), n).catch((e) => {
    throw plainAccountError(e, name, n.name)
  })
  const sym = n.symbol
  const prec = n.precision
  // All sums in whole units, so every size is exact.
  const units = (v: unknown): bigint => assetUnitsOf(str(v), prec, sym)
  let liquid = units(a.core_liquid_balance)
  if (!a.core_liquid_balance) {
    try {
      const bal: unknown = await readCall((ep) => chain.getCurrencyBalance(ep, 'eosio.token', name, sym), n)
      liquid = Array.isArray(bal) ? units(bal.find((b) => typeof b === 'string' && b.trim().endsWith(` ${sym}`))) : 0n
    } catch {
      liquid = 0n
    }
  }
  const self = (a.self_delegated_bandwidth ?? {}) as Record<string, unknown>
  const cpuSelf = units(self.cpu_weight)
  const netSelf = units(self.net_weight)
  const staked = cpuSelf + netSelf
  const refundReq = (a.refund_request ?? {}) as Record<string, unknown>
  const refundCpu = units(refundReq.cpu_amount)
  const refundNet = units(refundReq.net_amount)
  const refund = refundCpu + refundNet
  const refundRequested = refund > 0n ? chainTimePlus(str(refundReq.request_time), 0) : ''
  const left = refundRequested ? refundSecondsLeft(refundRequested, str(a.head_block_time)) : null
  const total = (a.total_resources ?? {}) as Record<string, unknown>
  const othersSum = units(total.cpu_weight) + units(total.net_weight) - staked
  const byOthers = othersSum > 0n ? othersSum : 0n
  const fmt = (u: bigint): string => formatUnits(u, prec, sym)
  const perms = permissions(a.permissions)
  const cpu = (a.cpu_limit ?? {}) as Record<string, unknown>
  const net = (a.net_limit ?? {}) as Record<string, unknown>
  let hasCode = false
  try {
    const h = await readCall((ep) => chain.getCodeHash(ep, name), n)
    hasCode = !!h.code_hash && !/^0+$/.test(h.code_hash)
  } catch {
    hasCode = false
  }
  return {
    name,
    network: n.id,
    symbol: sym,
    liquid: fmt(liquid),
    staked: fmt(staked),
    refund: fmt(refund),
    total: fmt(liquid + staked + refund),
    ram: { usage: num(a.ram_usage), quota: num(a.ram_quota) },
    cpu: { used: num(cpu.used), max: num(cpu.max) },
    net: { used: num(net.used), max: num(net.max) },
    cpuWeight: str(total.cpu_weight) || fmt(0n),
    netWeight: str(total.net_weight) || fmt(0n),
    permissions: perms,
    hasCode,
    created: str(a.created),
    cpuSelf: fmt(cpuSelf),
    netSelf: fmt(netSelf),
    stakedByOthers: fmt(byOthers),
    refundCpu: fmt(refundCpu),
    refundNet: fmt(refundNet),
    refundRequested,
    refundDue: refundRequested ? chainTimePlus(refundRequested, REFUND_DELAY_SEC) : '',
    // Without a head time the due time is compared with nothing: the full waiting time is assumed.
    refundSecondsLeft: refundRequested ? (left ?? REFUND_DELAY_SEC) : 0,
    refundExact: WAX_CHAIN_IDS.includes(n.chainId),
    control: controlledPermissions(perms, vaultKeys)
  }
}

const TRX_ID = /^[0-9a-f]{64}$/
const ACT_NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/
const ACT_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z?$/

/**
 * One page of the account's actions from the history service, newest first,
 * filtered by action name and time range. Rows from the service are untrusted:
 * a row without a transaction id of 64 hex characters, a valid contract and
 * action name is left out; times are taken only in the chain's form; the data
 * text is cut.
 */
export async function accountActions(name: string, skip: number, filter: AccountActionsFilter = {}, limit = ACTIONS_PAGE): Promise<AccountActionsPage> {
  const n = currentNetwork()
  if (!n.history) return { rows: [], historyAvailable: false, more: false }
  const r = await history.getActions(n.history, name, skip, limit, actionsQuery(filter))
  const list = Array.isArray(r.actions) ? r.actions.slice(0, limit) : []
  const rows: AccountActionRow[] = []
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const trxId = str(x.trx_id)
    const contract = str(x.act?.account)
    const action = str(x.act?.name)
    if (!TRX_ID.test(trxId) || !ACT_NAME.test(contract) || !ACT_NAME.test(action)) continue
    let data = ''
    try {
      data = JSON.stringify(x.act?.data ?? null) ?? ''
    } catch {
      data = ''
    }
    if (data.length > MAX_DATA_TEXT) data = data.slice(0, MAX_DATA_TEXT) + '…'
    const time = str(x['@timestamp'] ?? x.timestamp)
    const block = num(x.block_num)
    rows.push({ time: ACT_TIME.test(time) ? time : '', block: Number.isSafeInteger(block) && block >= 0 ? block : 0, trxId, contract, action, data })
  }
  const totalRaw = num(r.total?.value)
  const total = Number.isSafeInteger(totalRaw) && totalRaw > 0 ? totalRaw : 0
  const totalExact = total > 0 && r.total?.relation !== 'gte'
  const more = list.length === limit && (total === 0 || !totalExact || skip + list.length < total)
  // The service refuses a page that passes its window: the list ends one page before it.
  const windowEnd = more && nextPagePassesWindow(skip, limit)
  return { rows, historyAvailable: true, more: more && !windowEnd, total, totalExact, windowEnd }
}
