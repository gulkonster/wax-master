// Deploy: reads the built WASM and ABI once (or takes them as bytes), compares
// them with the account, checks host functions against the chain's active
// features, and prepares setcode/setabi with exactly those bytes. The hashes
// shown on the confirmation are computed by the signer from the code and ABI
// inside the packed transaction; the files are not read again.

import { createHash, randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { abiFromBinary, abiToBinary, bytesToHex } from '../chain-core'
import { effectiveOutput, type DeployTarget } from '../shared/project'
import { DEPLOY_PLAN_EXPIRED, type DeployPlan } from '../shared/chain-types'
import { currentProject, resolveInProject } from './projects'
import { abiRefusal, storedBuild } from './build'
import { buildForKind, variantFits, variantLabel } from './build-variant'
import { currentNetwork, effectiveKind, endpointOf, getNetwork, readCall } from './networks'
import { chain } from './rpc'
import { plainAccountError } from './account-pick'
import { wasmInfo } from './wasm-info'
import type { ActionRequest } from './signer'
import type { BuildVariant } from '../shared/api'


/** The chain's limit of net usage for one transaction when it cannot be read (the default of Antelope and WAX). */
export const DEFAULT_MAX_TX_NET = 524_288
/** Room for the transaction around the code and ABI bytes (header, actions, signature); a real deploy used 154 bytes. */
export const TX_NET_OVERHEAD = 2048

/** True when setcode and setabi together would pass the limit, so they go as two transactions (E59). */
export function needsTwoTransactions(codeBytes: number, abiBytes: number, limit: number): boolean {
  return codeBytes + abiBytes + TX_NET_OVERHEAD > limit
}

/** The part of a split deployment a transaction carries. */
export type DeployPart = 'code' | 'abi'

/** What a confirmation of a split deployment tells about both transactions. */
export interface DeploySequence {
  index: number
  count: number
  parts: string[]
}

/** max_transaction_net_usage from the system contract's global table; the default when it cannot be read. */
async function maxTransactionNet(networkId: string): Promise<number> {
  try {
    const r = await readCall((ep) => chain.getTableRows(ep, { code: 'eosio', scope: 'eosio', table: 'global', json: true, limit: 1 }), getNetwork(networkId))
    const v = Number((r.rows[0] as { max_transaction_net_usage?: unknown } | undefined)?.max_transaction_net_usage)
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_TX_NET
  } catch {
    return DEFAULT_MAX_TX_NET
  }
}

/** Host functions that need a protocol feature (by its builtin codename). */
export const FEATURE_OF_IMPORT: Record<string, string> = {
  set_action_return_value: 'ACTION_RETURN_VALUE',
  get_code_hash: 'GET_CODE_HASH',
  get_block_num: 'GET_BLOCK_NUM',
  get_sender: 'GET_SENDER',
  alt_bn128_add: 'CRYPTO_PRIMITIVES',
  alt_bn128_mul: 'CRYPTO_PRIMITIVES',
  alt_bn128_pair: 'CRYPTO_PRIMITIVES',
  mod_exp: 'CRYPTO_PRIMITIVES',
  blake2_f: 'CRYPTO_PRIMITIVES',
  sha3: 'CRYPTO_PRIMITIVES',
  k1_recover: 'CRYPTO_PRIMITIVES',
  get_parameters_packed: 'BLOCKCHAIN_PARAMETERS',
  set_parameters_packed: 'BLOCKCHAIN_PARAMETERS',
  get_wasm_parameters_packed: 'CONFIGURABLE_WASM_LIMITS2',
  set_wasm_parameters_packed: 'CONFIGURABLE_WASM_LIMITS2'
}

export function requiredFeature(importName: string): string | null {
  if (importName.startsWith('bls_')) return 'BLS_PRIMITIVES2'
  if (['call', 'get_call_return_value', 'set_call_return_value', 'get_call_data'].includes(importName)) return 'SYNC_CALL'
  return FEATURE_OF_IMPORT[importName] ?? null
}

/** Bytes held by base64 text (with or without the padding). */
export function base64Size(text: string | undefined | null): number {
  const s = (text ?? '').replace(/\s+/g, '').replace(/=+$/, '')
  return Math.floor((s.length * 3) / 4)
}

/**
 * RAM a deployment adds to the account. The chain bills setcode at 10 x the
 * code size and setabi at the ABI size, each less what it replaces, so a
 * redeployment counts only the difference. Never below zero.
 */
export function deployRam(i: {
  sendWasm: boolean
  wasmSize: number
  chainCodeSize: number
  sendAbi: boolean
  abiSize: number
  chainAbiSize: number
}): { needed: number; newBytes: number; replacedBytes: number } {
  const newBytes = (i.sendWasm ? i.wasmSize * 10 : 0) + (i.sendAbi ? i.abiSize : 0)
  const replacedBytes = (i.sendWasm ? i.chainCodeSize * 10 : 0) + (i.sendAbi ? i.chainAbiSize : 0)
  return { needed: Math.max(0, newBytes - replacedBytes), newBytes, replacedBytes }
}

/**
 * Hash of the code now on an account ('' for none). A failed read is taken as
 * no code for the comparison, and reported as unread.
 */
export async function readCodeHash(read: () => Promise<{ code_hash: string }>): Promise<{ hash: string; unread: boolean }> {
  try {
    const r = await read()
    return { hash: /^0+$/.test(r.code_hash) ? '' : r.code_hash, unread: false }
  } catch {
    return { hash: '', unread: true }
  }
}

/** SHA-256 of zero bytes: the abi_hash a node reports for an account without an ABI. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * Hash of the ABI now on an account ('' for none). A node reports zeros or the
 * SHA-256 of an empty ABI for an account that has none; both mean "(none)".
 */
export function chainAbiHashOf(raw: { abi_hash?: string; abi?: string } | null): string {
  if (!raw || !raw.abi_hash || /^0+$/.test(raw.abi_hash)) return ''
  if (raw.abi_hash.toLowerCase() === EMPTY_SHA256 || raw.abi === '') return ''
  return raw.abi_hash
}

/**
 * Size of the code now on an account. Read only when the account has code and
 * new code is sent; a failed read counts as zero and is reported as unread.
 * `hashUnread`: new code is sent but the code hash could not be read, so
 * whether the account has code is not known; counted as zero and reported.
 */
export async function chainCodeSize(
  hasCode: boolean,
  read: () => Promise<{ wasm?: string }>,
  hashUnread = false
): Promise<{ size: number; unread: boolean }> {
  if (hashUnread) return { size: 0, unread: true }
  if (!hasCode) return { size: 0, unread: false }
  try {
    return { size: base64Size((await read()).wasm), unread: false }
  } catch {
    return { size: 0, unread: true }
  }
}

interface PlanBytes {
  networkId: string
  account: string
  permission: string
  wasm?: Uint8Array
  abi?: Uint8Array
  currentCodeHash: string
  createdAt: number
  build: BuildVariant | null
}

const plans = new Map<string, PlanBytes>()
const PLAN_TTL_MS = 10 * 60 * 1000

function sha(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex')
}

async function activeFeatures(networkId: string): Promise<Set<string>> {
  const n = getNetwork(networkId)
  const r = await readCall((ep) => chain.getActivatedProtocolFeatures(ep), n)
  const names = new Set<string>()
  for (const f of r.activated_protocol_features ?? []) {
    const code = f.specification?.find((x) => x.name === 'builtin_feature_codename')?.value
    if (code) names.add(code)
  }
  return names
}

/**
 * Code and ABI given as bytes instead of the project's files (a contract read
 * from another network). `abi` is the binary ABI as a node returns it; null or
 * empty: code only. `label` names the bytes where a file name would stand.
 */
export interface DeployBytes {
  wasm: Uint8Array
  abi: Uint8Array | null
  label: string
}

export async function planDeploy(input: {
  networkId?: string
  account: string
  permission: string
  target: DeployTarget
  bytes?: DeployBytes
}): Promise<DeployPlan> {
  const network = input.networkId ? getNetwork(input.networkId) : currentNetwork()
  let wasmRel: string
  let abiRel: string
  let wasm: Uint8Array | undefined
  let abi: Uint8Array | undefined
  /** Which build of the project is deployed (E64); null for bytes that are not a project build. */
  let build: BuildVariant | null = null
  if (input.bytes) {
    const b = input.bytes
    wasmRel = `${b.label} (code)`
    abiRel = `${b.label} (ABI)`
    if (input.target !== 'abi') {
      if (b.wasm.length === 0) throw new Error(`${b.label} has no code`)
      wasm = b.wasm
    }
    if (input.target !== 'wasm' && b.abi && b.abi.length > 0) {
      try {
        abiFromBinary(b.abi)
      } catch (e) {
        throw new Error(`The ABI of ${b.label} is not a valid ABI: ${e instanceof Error ? e.message : String(e)}`)
      }
      abi = b.abi
    }
  } else {
    const p = currentProject()
    if (!p) throw new Error('No project is open')
    // E64: the files on disk must be the build this network takes (Deploy builds it first by itself).
    const takes = buildForKind(effectiveKind(network))
    build = storedBuild(p.root)?.variant ?? 'any'
    if (!variantFits(build, takes)) {
      throw new Error(`The files on disk are the ${variantLabel(build)}, and ${network.name} takes the ${takes} build. Press Rebuild in Deploy to build it.`)
    }
    wasmRel = effectiveOutput(p.config)
    abiRel = wasmRel.replace(/\.wasm$/i, '') + '.abi'
    if (input.target !== 'abi') {
      const st = await fsp.stat(resolveInProject(wasmRel)).catch(() => null)
      if (!st) throw new Error(`${wasmRel} was not found. Build the contract first.`)
      wasm = new Uint8Array(await fsp.readFile(resolveInProject(wasmRel)))
    }
    if (input.target !== 'wasm') {
      const text = await fsp.readFile(resolveInProject(abiRel), 'utf8').catch(() => null)
      if (text === null) throw new Error(`${abiRel} was not found. Build the contract first.`)
      // An ABI the chain refuses stops Deploy and Simulate Deploy with the build's explanation.
      const refusal = await abiRefusal(p.root, abiRel, text)
      if (refusal) throw new Error(refusal)
      try {
        abi = abiToBinary(text)
      } catch (e) {
        throw new Error(`${abiRel} is not a valid ABI: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  // What is on the account now.
  const hashRead = await readCodeHash(() => readCall((ep) => chain.getCodeHash(ep, input.account), network))
  const codeHash = hashRead.hash
  const rawAbi = await readCall((ep) => chain.getRawAbi(ep, input.account), network).catch(() => null)
  const chainAbiHash = chainAbiHashOf(rawAbi)
  const account = await readCall((ep) => chain.getAccount(ep, input.account), network).catch((e) => {
    throw plainAccountError(e, input.account, network.name)
  })
  const wasmHash = wasm ? sha(wasm) : undefined
  const abiHash = abi ? sha(abi) : undefined
  const sendWasm = !!wasm && wasmHash !== codeHash
  const sendAbi = !!abi && abiHash !== chainAbiHash
  // One transaction may carry at most the chain's net limit: a big contract goes as code first, then ABI.
  const netLimit = sendWasm || sendAbi ? await maxTransactionNet(network.id) : DEFAULT_MAX_TX_NET
  const split = sendWasm && sendAbi && needsTwoTransactions(wasm!.length, abi!.length, netLimit)
  // Feature check of host functions.
  const missing: { name: string; feature: string }[] = []
  if (wasm) {
    const info = wasmInfo(wasm)
    if (!info.valid) throw new Error(`${wasmRel} is not a valid WebAssembly module: ${info.error}`)
    const active = await activeFeatures(network.id).catch(() => null)
    if (active) {
      for (const imp of info.imports.filter((i) => i.kind === 'function')) {
        const f = requiredFeature(imp.name)
        if (f && !active.has(f)) missing.push({ name: imp.name, feature: f })
      }
    }
  }
  // RAM: setcode costs about 10x the code size, the ABI its own size; both less what they replace.
  const onAccount = await chainCodeSize(
    sendWasm && codeHash !== '',
    () => readCall((ep) => chain.getRawCodeAndAbi(ep, input.account), network),
    sendWasm && hashRead.unread
  )
  const ram = deployRam({
    sendWasm,
    wasmSize: wasm?.length ?? 0,
    chainCodeSize: onAccount.size,
    sendAbi,
    abiSize: abi?.length ?? 0,
    chainAbiSize: chainAbiHash ? base64Size(rawAbi?.abi) : 0
  })
  const quota = Number(account.ram_quota ?? 0)
  const usage = Number(account.ram_usage ?? 0)
  const id = randomUUID()
  plans.set(id, {
    networkId: network.id,
    account: input.account,
    permission: input.permission,
    wasm: sendWasm ? wasm : undefined,
    abi: sendAbi ? abi : undefined,
    currentCodeHash: codeHash,
    createdAt: Date.now(),
    build
  })
  for (const [k, v] of plans) if (Date.now() - v.createdAt > PLAN_TTL_MS) plans.delete(k)
  return {
    id,
    network: network.name,
    networkKind: network.kind,
    endpoint: endpointOf(network),
    account: input.account,
    permission: input.permission,
    wasmFile: wasm ? wasmRel : null,
    abiFile: abi ? abiRel : null,
    wasmSha256: wasmHash ?? null,
    abiSha256: abiHash ?? null,
    wasmSize: wasm?.length ?? null,
    abiSize: abi?.length ?? null,
    chainCodeHash: codeHash,
    chainAbiHash,
    sendWasm,
    sendAbi,
    ramNeeded: ram.needed,
    ramNew: ram.newBytes,
    ramReplaced: ram.replacedBytes,
    chainCodeUnread: onAccount.unread,
    ramAvailable: quota < 0 ? -1 : Math.max(0, quota - usage),
    missingFeatures: missing,
    split,
    netLimit,
    build
  }
}

/**
 * Builds setcode/setabi for a plan with the exact bytes read when the plan was made.
 * With `part` only one of them (a split deployment, E59): the code part keeps the plan
 * for the ABI part; the ABI part uses it up. `sequence` then says what the confirmation
 * shows about both transactions.
 */
export function deployActions(
  planId: string,
  opts: { clear?: boolean; keep?: boolean; part?: DeployPart } = {}
): { networkId: string; actions: ActionRequest[]; sequence?: DeploySequence; build: BuildVariant | null } {
  const p = plans.get(planId)
  if (!p) throw new Error(DEPLOY_PLAN_EXPIRED)
  if (opts.part === 'code' && !p.wasm) throw new Error('This plan sends no code.')
  if (opts.part === 'abi' && !p.abi) throw new Error('This plan sends no ABI.')
  if (!opts.keep && opts.part !== 'code') plans.delete(planId)
  const auth = [{ actor: p.account, permission: p.permission }]
  const actions: ActionRequest[] = []
  const withCode = opts.part !== 'abi'
  const withAbi = opts.part !== 'code'
  let sequence: DeploySequence | undefined
  if (opts.part && p.wasm && p.abi) {
    const size = (n: number): string => `${n.toLocaleString('en-US')} bytes`
    sequence = {
      index: opts.part === 'code' ? 1 : 2,
      count: 2,
      parts: [`setcode: the code, ${size(p.wasm.length)}`, `setabi: the ABI, ${size(p.abi.length)}`]
    }
  }
  if (p.wasm && withCode) actions.push({ account: 'eosio', name: 'setcode', authorization: auth, data: { account: p.account, vmtype: 0, vmversion: 0, code: bytesToHex(p.wasm) } })
  if (p.abi && withAbi) actions.push({ account: 'eosio', name: 'setabi', authorization: auth, data: { account: p.account, abi: bytesToHex(p.abi) } })
  if (actions.length === 0 && !opts.clear) throw new Error('Nothing to deploy: the account already has this WASM and ABI.')
  // The signer computes the shown hashes and sizes from these bytes as packed in the transaction.
  return { networkId: p.networkId, actions, sequence, build: p.build }
}

/** Clear Contract Code: empty setcode and setabi. */
export function clearCodeActions(account: string, permission: string): ActionRequest[] {
  const auth = [{ actor: account, permission }]
  return [
    { account: 'eosio', name: 'setcode', authorization: auth, data: { account, vmtype: 0, vmversion: 0, code: '' } },
    { account: 'eosio', name: 'setabi', authorization: auth, data: { account, abi: '' } }
  ]
}
