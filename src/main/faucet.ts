// WAX Testnet faucet: creates a testnet account with keys made by the service
// and sends test tokens. The answer is read only here; private keys go straight
// into the vault and are never logged or sent to a window.

import { parsePrivateKey } from '../chain-core'
import { redact } from './log'
import type { Vault } from './vault'

export const FAUCET_HOST = 'https://faucet.waxsweden.org'
const TIMEOUT_MS = 20_000
const MAX_BYTES = 64 * 1024
const NAME = /^[a-z1-5]{12}$/

export interface FaucetKeys {
  owner: string
  active: string
}

export interface FaucetResult {
  ok: boolean
  message: string
  account?: string
  ownerPublic?: string
  activePublic?: string
}

export type Fetcher = (url: string) => Promise<{ status: number; text: string }>

/** Reads the body while it arrives and stops as soon as it passes `max` bytes. */
export async function readCapped(res: Response, max: number, onTooLarge: () => void = () => undefined): Promise<string> {
  const tooLarge = (): Error => {
    onTooLarge()
    return new Error('The faucet answer is too large')
  }
  if (Number(res.headers.get('content-length') ?? '0') > max) {
    await res.body?.cancel().catch(() => undefined)
    throw tooLarge()
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export const defaultFetcher: Fetcher = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error', credentials: 'omit' })
    const text = await readCapped(res, MAX_BYTES, () => controller.abort())
    return { status: res.status, text }
  } catch (e) {
    if (controller.signal.aborted) throw new Error('The faucet did not answer within 20 seconds')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export function randomTestnetName(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz12345'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function message(json: unknown, fallback: string): string {
  const m = (json as { msg?: unknown; message?: unknown } | null)?.msg ?? (json as { message?: unknown } | null)?.message
  return typeof m === 'string' ? redact(m.slice(0, 300)) : fallback
}

/** Finds the owner and active private keys in the faucet's answer. */
export function extractKeys(json: unknown): FaucetKeys | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>
  const keys = (typeof j.keys === 'object' && j.keys !== null ? j.keys : j) as Record<string, unknown>
  const pick = (role: 'owner' | 'active'): string | null => {
    const v = keys[`${role}_key`] ?? keys[role]
    const priv = typeof v === 'string' ? v : typeof v === 'object' && v !== null ? (v as Record<string, unknown>).private : null
    return typeof priv === 'string' ? priv.trim() : null
  }
  const owner = pick('owner')
  const active = pick('active')
  if (!owner || !active) return null
  for (const k of [owner, active]) {
    try {
      if (parsePrivateKey(k).type !== 'K1') return null
    } catch {
      return null
    }
  }
  return { owner, active }
}


/** Creates the account and imports both keys into the (unlocked) vault. */
export async function createTestnetAccount(name: string, vault: Vault, fetcher: Fetcher = defaultFetcher): Promise<FaucetResult> {
  if (!NAME.test(name)) return { ok: false, message: 'The name must be 12 characters: a-z and 1-5.' }
  if (!vault.isUnlocked()) return { ok: false, message: 'The vault is locked; nothing was requested from the faucet.' }
  let res: { status: number; text: string }
  try {
    res = await fetcher(`${FAUCET_HOST}/create_account?${name}`)
  } catch (e) {
    return { ok: false, message: `The faucet could not be reached: ${e instanceof Error ? e.message : String(e)}` }
  }
  let json: unknown = null
  try {
    json = JSON.parse(res.text)
  } catch {
    return { ok: false, message: `The faucet answered in an unexpected form (HTTP ${res.status}). Nothing was imported.` }
  }
  const keys = res.status === 200 ? extractKeys(json) : null
  if (!keys) {
    return { ok: false, message: `${message(json, `HTTP ${res.status}`)} Nothing was imported.` }
  }
  // The vault may have locked during the wait; the account then exists without its keys in the vault.
  if (!vault.isUnlocked()) {
    return {
      ok: false,
      account: name,
      message: `The vault was locked while the faucet worked. The account ${name} was probably created, but its keys could not be stored and cannot be recovered. Use another account name.`
    }
  }
  let owner: { publicKey: string }
  try {
    owner = vault.addKey(keys.owner, `${name} owner (faucet)`, 'none')
  } catch {
    return {
      ok: false,
      account: name,
      message: `The account ${name} was created, but its keys could not be stored (the vault locked or refused them). Nothing else can be done; use another account name.`
    }
  }
  let active: { publicKey: string }
  try {
    active = keys.active === keys.owner ? owner : vault.addKey(keys.active, `${name} active (faucet)`, 'none')
  } catch {
    return {
      ok: false,
      account: name,
      ownerPublic: owner.publicKey,
      message: `Half import: the account ${name} was created and its owner key is in the vault, but its active key could not be stored. Nothing else can be done; use the owner key to set a new active key.`
    }
  }
  return {
    ok: true,
    message: message(json, 'Account created'),
    account: name,
    ownerPublic: owner.publicKey,
    activePublic: active.publicKey
  }
}

export async function requestTokens(name: string, fetcher: Fetcher = defaultFetcher): Promise<FaucetResult> {
  if (!/^[a-z1-5.]{1,12}$/.test(name)) return { ok: false, message: 'Not a valid account name.' }
  try {
    const res = await fetcher(`${FAUCET_HOST}/get_token?${name}`)
    let json: unknown = null
    try {
      json = JSON.parse(res.text)
    } catch {
      json = null
    }
    return { ok: res.status === 200, message: message(json, res.status === 200 ? 'Requested.' : `HTTP ${res.status}`) }
  } catch (e) {
    return { ok: false, message: `The faucet could not be reached: ${e instanceof Error ? e.message : String(e)}` }
  }
}

