// Builds the Account page data from get_account and the history API.
// All chain data is untrusted: values are type-checked and passed on as text.

import type { AccountActionsPage, AccountView, PermissionView } from '../shared/chain-types'
import { chain, history } from './rpc'
import { currentNetwork, readCall } from './networks'

const MAX_DATA_TEXT = 4000

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** "12.34500000 WAX" -> 12.345 (as a number of whole units) */
function assetAmount(a: string): number {
  const m = /^(-?\d+(?:\.\d+)?)\s+[A-Z]{1,7}$/.exec(a.trim())
  return m ? Number(m[1]) : 0
}

function fmt(amount: number, precision: number, symbol: string): string {
  return `${amount.toFixed(precision)} ${symbol}`
}

function permissions(raw: unknown): PermissionView[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p: Record<string, unknown>) => {
    const auth = (p.required_auth ?? {}) as Record<string, unknown>
    return {
      name: str(p.perm_name),
      parent: str(p.parent),
      threshold: num(auth.threshold),
      keys: Array.isArray(auth.keys) ? auth.keys.map((k: Record<string, unknown>) => ({ key: str(k.key), weight: num(k.weight) })) : [],
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

export async function accountView(name: string): Promise<AccountView> {
  const n = currentNetwork()
  const a = await readCall((ep) => chain.getAccount(ep, name), n)
  const sym = n.symbol
  const prec = n.precision
  let liquid = assetAmount(str(a.core_liquid_balance))
  if (!a.core_liquid_balance) {
    try {
      const bal = await readCall((ep) => chain.getCurrencyBalance(ep, 'eosio.token', name, sym), n)
      liquid = bal.length ? assetAmount(bal[0]) : 0
    } catch {
      liquid = 0
    }
  }
  const self = (a.self_delegated_bandwidth ?? {}) as Record<string, unknown>
  const staked = assetAmount(str(self.cpu_weight)) + assetAmount(str(self.net_weight))
  const refundReq = (a.refund_request ?? {}) as Record<string, unknown>
  const refund = assetAmount(str(refundReq.cpu_amount)) + assetAmount(str(refundReq.net_amount))
  const total = (a.total_resources ?? {}) as Record<string, unknown>
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
    liquid: fmt(liquid, prec, sym),
    staked: fmt(staked, prec, sym),
    refund: fmt(refund, prec, sym),
    total: fmt(liquid + staked + refund, prec, sym),
    ram: { usage: num(a.ram_usage), quota: num(a.ram_quota) },
    cpu: { used: num(cpu.used), max: num(cpu.max) },
    net: { used: num(net.used), max: num(net.max) },
    cpuWeight: str(total.cpu_weight) || fmt(0, prec, sym),
    netWeight: str(total.net_weight) || fmt(0, prec, sym),
    permissions: permissions(a.permissions),
    hasCode,
    created: str(a.created)
  }
}

export async function accountActions(name: string, skip: number, limit = 20): Promise<AccountActionsPage> {
  const n = currentNetwork()
  if (!n.history) return { rows: [], historyAvailable: false, more: false }
  const r = await history.getActions(n.history, name, skip, limit)
  const list = Array.isArray(r.actions) ? r.actions : []
  const rows = list.map((x) => {
    let data = ''
    try {
      data = JSON.stringify(x.act?.data ?? null)
    } catch {
      data = ''
    }
    if (data.length > MAX_DATA_TEXT) data = data.slice(0, MAX_DATA_TEXT) + '…'
    return {
      time: str(x['@timestamp'] ?? x.timestamp),
      block: num(x.block_num),
      trxId: str(x.trx_id),
      contract: str(x.act?.account),
      action: str(x.act?.name),
      data
    }
  })
  const total = num(r.total?.value)
  return { rows, historyAvailable: true, more: list.length === limit && (total === 0 || skip + list.length < total) }
}
