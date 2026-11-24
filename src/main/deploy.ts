// Deploy: reads the built WASM and ABI once, compares them with the account,
// checks host functions against the chain's active features, and prepares
// setcode/setabi with exactly those bytes. The hashes shown on the confirmation
// are computed by the signer from the code and ABI inside the packed
// transaction; the files are not read again.

import { createHash, randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { abiToBinary, bytesToHex } from '../chain-core'
import { effectiveOutput, type DeployTarget } from '../shared/project'
import type { DeployPlan } from '../shared/chain-types'
import { currentProject, resolveInProject } from './projects'
import { abiRefusal } from './build'
import { currentNetwork, endpointOf, getNetwork, readCall } from './networks'
import { chain } from './rpc'
import { wasmInfo } from './wasm-info'
import type { ActionRequest } from './signer'

const MAX_WASM = 8 * 1024 * 1024
const MAX_ABI_JSON = 2 * 1024 * 1024

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

interface PlanBytes {
  networkId: string
  account: string
  permission: string
  wasm?: Uint8Array
  abi?: Uint8Array
  currentCodeHash: string
  createdAt: number
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

export async function planDeploy(input: { networkId?: string; account: string; permission: string; target: DeployTarget }): Promise<DeployPlan> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  const network = input.networkId ? getNetwork(input.networkId) : currentNetwork()
  const wasmRel = effectiveOutput(p.config)
  const abiRel = wasmRel.replace(/\.wasm$/i, '') + '.abi'
  let wasm: Uint8Array | undefined
  let abi: Uint8Array | undefined
  if (input.target !== 'abi') {
    const st = await fsp.stat(resolveInProject(wasmRel)).catch(() => null)
    if (!st) throw new Error(`${wasmRel} was not found. Build the contract first.`)
    if (st.size > MAX_WASM) throw new Error(`${wasmRel} is larger than ${MAX_WASM / 1024 / 1024} MB`)
    wasm = new Uint8Array(await fsp.readFile(resolveInProject(wasmRel)))
  }
  if (input.target !== 'wasm') {
    const text = await fsp.readFile(resolveInProject(abiRel), 'utf8').catch(() => null)
    if (text === null) throw new Error(`${abiRel} was not found. Build the contract first.`)
    if (text.length > MAX_ABI_JSON) throw new Error(`${abiRel} is too large`)
    // An ABI the chain refuses stops Deploy and Simulate Deploy with the build's explanation.
    const refusal = await abiRefusal(p.root, abiRel, text)
    if (refusal) throw new Error(refusal)
    try {
      abi = abiToBinary(text)
    } catch (e) {
      throw new Error(`${abiRel} is not a valid ABI: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // What is on the account now.
  const codeHash = await readCall((ep) => chain.getCodeHash(ep, input.account), network)
    .then((r) => (/^0+$/.test(r.code_hash) ? '' : r.code_hash))
    .catch(() => '')
  const rawAbi = await readCall((ep) => chain.getRawAbi(ep, input.account), network).catch(() => null)
  const chainAbiHash = rawAbi && rawAbi.abi_hash && !/^0+$/.test(rawAbi.abi_hash) ? rawAbi.abi_hash : ''
  const account = await readCall((ep) => chain.getAccount(ep, input.account), network)
  const wasmHash = wasm ? sha(wasm) : undefined
  const abiHash = abi ? sha(abi) : undefined
  const sendWasm = !!wasm && wasmHash !== codeHash
  const sendAbi = !!abi && abiHash !== chainAbiHash
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
  // RAM: setcode costs about 10x the code size; the ABI its own size.
  const ramNeeded = (sendWasm && wasm ? wasm.length * 10 : 0) + (sendAbi && abi ? abi.length : 0)
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
    createdAt: Date.now()
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
    ramNeeded,
    ramAvailable: quota < 0 ? -1 : Math.max(0, quota - usage),
    missingFeatures: missing
  }
}

/** Builds setcode/setabi for a plan with the exact bytes read when the plan was made. */
export function deployActions(planId: string, opts: { clear?: boolean; keep?: boolean } = {}): { networkId: string; actions: ActionRequest[] } {
  const p = plans.get(planId)
  if (!p) throw new Error('The deploy plan expired. Open Deploy again.')
  if (!opts.keep) plans.delete(planId)
  const auth = [{ actor: p.account, permission: p.permission }]
  const actions: ActionRequest[] = []
  if (p.wasm) actions.push({ account: 'eosio', name: 'setcode', authorization: auth, data: { account: p.account, vmtype: 0, vmversion: 0, code: bytesToHex(p.wasm) } })
  if (p.abi) actions.push({ account: 'eosio', name: 'setabi', authorization: auth, data: { account: p.account, abi: bytesToHex(p.abi) } })
  if (actions.length === 0 && !opts.clear) throw new Error('Nothing to deploy: the account already has this WASM and ABI.')
  // The signer computes the shown hashes and sizes from these bytes as packed in the transaction.
  return { networkId: p.networkId, actions }
}

/** Clear Contract Code: empty setcode and setabi. */
export function clearCodeActions(account: string, permission: string): ActionRequest[] {
  const auth = [{ actor: account, permission }]
  return [
    { account: 'eosio', name: 'setcode', authorization: auth, data: { account, vmtype: 0, vmversion: 0, code: '' } },
    { account: 'eosio', name: 'setabi', authorization: auth, data: { account, abi: '' } }
  ]
}
