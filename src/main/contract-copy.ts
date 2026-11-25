// Copy a contract from another network to the app's local chain (decision B111 points 1-4).
// The source is only read (get_raw_code_and_abi through readCall of that network); nothing is
// signed there. A missing target account is created by `eosio` as in B109 point 4, with RAM for
// ten times the code plus 1 MiB. The code and ABI are then deployed by the existing deployment
// as bytes, signed from the vault with the normal confirmation. The SHA-256 of the code is given
// before (the source's, of the bytes read) and after (read back from the local chain).

import { createHash } from 'node:crypto'
import {
  abiFromBinary,
  bytesToHex,
  encodeAction,
  headerFromChainInfo,
  packTransaction,
  parseAbi,
  parsePrivateKey,
  parsePublicKey,
  publicFromPrivate,
  publicKeyToString,
  signDigest,
  signatureToString,
  signingDigest,
  transactionId,
  type AbiDef,
  type Action
} from '../chain-core'
import { LOCAL_CHAIN_NETWORK_ID } from '../shared/local-chain'
import type { ContractCopyInput, ContractCopyResult, ContractCopySource, ContractCopyTarget, ContractReadInput } from '../shared/api'
import { assertLocalChain } from './local-chain-boot'
import { NOT_RUNNING_TEXT, defaultLocalAccountsDeps, newAccountActions, type LocalAccountsDeps } from './local-chain-accounts'
import { deployActions, planDeploy } from './deploy'
import { getNetwork, readCall } from './networks'
import { chain, type ChainInfo } from './rpc'
import { plainAccountError } from './account-pick'
import type { ActionRequest } from './signer'

/** B111 point 1: the largest code that is copied. */
export const MAX_COPY_CODE = 4 * 1024 * 1024
/** B111 point 2: RAM of a created target beyond ten times the code. */
export const COPY_EXTRA_RAM = 1_048_576
/** B109 point 4 buys this much already; the copy buys the rest. */
const BASE_RAM = 1_048_576

const ANY_NAME = /^[a-z1-5.]{0,11}[a-z1-5]$|^[a-z1-5.]{12}[a-j1-5]$/
const READ_TTL_MS = 30 * 60 * 1000
const MAX_READS = 4

export function noCodeText(account: string, network: string): string {
  return `${account} has no contract on ${network}: there is no code to copy.`
}

export function replaceText(target: string): string {
  return `${target} on Local chain already has other code. Tick "Replace it with the copy" to replace it.`
}

export function ramShortText(target: string, needed: number, available: number): string {
  const n = (x: number): string => x.toLocaleString('en-US')
  return `${target} needs about ${n(needed)} bytes of RAM for the copy and has ${n(available)} bytes free. Buy RAM for it in the RAM section of its Account page, then copy again.`
}

export const COPY_CANCELLED ='The deployment was cancelled: nothing was copied.'

export function sha256Hex(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex')
}

/** RAM a created target gets: ten times the code plus 1 MiB (B111 point 2). */
export function copyRamBytes(codeSize: number): number {
  return codeSize * 10 + COPY_EXTRA_RAM
}

interface SourceRead {
  network: string
  account: string
  wasm: Uint8Array
  abi: Uint8Array | null
  actions: string[]
  tables: string[]
  at: number
}

/** Bytes read from a source, by "<network id>/<account>", so Copy deploys exactly what Read showed. */
const reads = new Map<string, SourceRead>()

/** The outcome of the vault-signed deployment (the normal confirmation). */
export type CopySignOutcome = { status: 'sent'; transactionId: string } | { status: 'failed'; error: string } | { status: 'cancelled' }

export interface ContractCopyDeps {
  local: LocalAccountsDeps
  /** get_raw_code_and_abi of `account` on the saved network `networkId` (a read; nothing is signed there). */
  readSource: (networkId: string, account: string) => Promise<{ network: string; wasm: string; abi: string }>
  plan: typeof planDeploy
  actions: typeof deployActions
  /** Signs from the vault with the normal confirmation and sends to the network. */
  sign: (networkId: string, actions: ActionRequest[]) => Promise<CopySignOutcome>
  now: () => number
}

export function defaultContractCopyDeps(sign: ContractCopyDeps['sign']): ContractCopyDeps {
  return {
    local: defaultLocalAccountsDeps(),
    readSource: async (networkId, account) => {
      const n = getNetwork(networkId)
      const raw = await readCall((ep) => chain.getRawCodeAndAbi(ep, account), n).catch((e) => {
        throw plainAccountError(e, account, n.name)
      })
      return { network: n.name, wasm: raw.wasm ?? '', abi: raw.abi ?? '' }
    },
    plan: planDeploy,
    actions: deployActions,
    sign,
    now: () => Date.now()
  }
}

function checkName(name: string, what: string): string {
  if (typeof name !== 'string' || !ANY_NAME.test(name)) throw new Error(`${what}: not a valid account name`)
  return name
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from((text ?? '').replace(/\s+/g, ''), 'base64'))
}

function readKey(networkId: string, account: string): string {
  return `${networkId}/${account}`
}

function summary(networkId: string, r: SourceRead): ContractCopySource {
  return {
    networkId,
    network: r.network,
    account: r.account,
    codeHash: sha256Hex(r.wasm),
    codeSize: r.wasm.length,
    abiSize: r.abi?.length ?? 0,
    actions: r.actions,
    tables: r.tables
  }
}

// ---------------------------------------------------------------- B111 point 1

async function readSource(input: ContractReadInput, deps: ContractCopyDeps): Promise<SourceRead> {
  const account = checkName(input.account, 'account')
  if (input.networkId === LOCAL_CHAIN_NETWORK_ID) throw new Error('Choose another network as the source: this is the local chain itself.')
  const raw = await deps.readSource(input.networkId, account)
  const wasm = fromBase64(raw.wasm)
  if (wasm.length === 0) throw new Error(noCodeText(account, raw.network))
  if (wasm.length > MAX_COPY_CODE) {
    throw new Error(`The code of ${account} is ${wasm.length.toLocaleString('en-US')} bytes; at most ${MAX_COPY_CODE / 1024 / 1024} MB is copied.`)
  }
  const abiBytes = fromBase64(raw.abi)
  const r: SourceRead = { network: raw.network, account, wasm, abi: null, actions: [], tables: [], at: deps.now() }
  if (abiBytes.length > 0) {
    try {
      const def = abiFromBinary(abiBytes)
      r.actions = def.actions.map((a) => a.name)
      r.tables = def.tables.map((t) => t.name)
    } catch (e) {
      throw new Error(`The ABI of ${account} on ${raw.network} cannot be read: ${e instanceof Error ? e.message : String(e)}`)
    }
    r.abi = abiBytes
  }
  const key = readKey(input.networkId, account)
  reads.delete(key)
  reads.set(key, r)
  for (const [k, v] of reads) if (r.at - v.at > READ_TTL_MS) reads.delete(k)
  while (reads.size > MAX_READS) reads.delete(reads.keys().next().value as string)
  return r
}

/** Reads the code and ABI of an account on a saved network; refuses an account without code. */
export async function copyRead(input: ContractReadInput, deps: ContractCopyDeps): Promise<ContractCopySource> {
  return summary(input.networkId, await readSource(input, deps))
}

// ---------------------------------------------------------------- the local chain

interface Ready {
  endpoint: string
  chainId: string
  key: string
}

async function runningEndpoint(deps: LocalAccountsDeps): Promise<string> {
  const s = await deps.status()
  if (s.phase !== 'running') throw new Error(NOT_RUNNING_TEXT)
  return s.endpoint
}

/** The running chain, its system key and the guard of B109 point 3; else throws. */
async function ready(deps: LocalAccountsDeps): Promise<Ready> {
  const s = await deps.status()
  if (s.phase !== 'running') throw new Error(NOT_RUNNING_TEXT)
  const key = await deps.systemKey()
  const pub = publicKeyToString(publicFromPrivate(parsePrivateKey(key)))
  await assertLocalChain(s.endpoint, pub, { port: s.port, chainId: s.chainId, networkId: LOCAL_CHAIN_NETWORK_ID }, { request: deps.request })
  return { endpoint: s.endpoint, chainId: s.chainId, key }
}

async function sendAsEosio(r: Ready, deps: LocalAccountsDeps, actions: Action[]): Promise<string> {
  const info = await deps.request<ChainInfo>(r.endpoint, '/v1/chain/get_info', {})
  const packed = packTransaction({ ...headerFromChainInfo(info, 120, true), actions })
  const sig = signDigest(signingDigest(r.chainId, packed), parsePrivateKey(r.key))
  const body = { signatures: [signatureToString(sig)], compression: 0, packed_context_free_data: '', packed_trx: bytesToHex(packed) }
  await deps.request(r.endpoint, '/v1/chain/send_transaction', body, 60_000)
  return transactionId(packed)
}

function isMissing(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e)
  return /unknown key|unknown_account|account_query_exception|does not exist/i.test(text)
}

async function exists(endpoint: string, name: string, deps: LocalAccountsDeps): Promise<boolean> {
  try {
    await deps.request(endpoint, '/v1/chain/get_account', { account_name: name })
    return true
  } catch (e) {
    if (isMissing(e)) return false
    throw e
  }
}

async function codeHashAt(endpoint: string, name: string, deps: LocalAccountsDeps): Promise<string> {
  const r = await deps.request<{ code_hash?: string }>(endpoint, '/v1/chain/get_code_hash', { account_name: name })
  return /^0*$/.test(r.code_hash ?? '') ? '' : (r.code_hash as string)
}

async function readAbi(deps: LocalAccountsDeps, contract: 'eosio.system' | 'eosio.token'): Promise<AbiDef> {
  try {
    return parseAbi(JSON.parse((await deps.readResource(`contracts/${contract}.abi`)).toString('utf8')))
  } catch {
    throw new Error(`The contract files of ${contract} are missing from the app's resources`)
  }
}

function normalizeKey(k: string): string {
  try {
    return publicKeyToString(parsePublicKey(k.trim()), 'new')
  } catch {
    throw new Error(`Not a valid public key: ${k}`)
  }
}

/**
 * The actions that create a copy's target: those of B109 point 4 (1 MiB of RAM, 100 WAX CPU and NET,
 * 10,000 WAX) and one more `buyrambytes` for ten times the code, so the account holds 10 x code + 1 MiB.
 */
export function copyAccountActions(name: string, publicKey: string, codeSize: number, abis: { system: AbiDef; token: AbiDef }): Action[] {
  const base = newAccountActions(name, publicKey, abis)
  const more = copyRamBytes(codeSize) - BASE_RAM
  if (more <= 0) return base
  const extra: Action = {
    account: 'eosio',
    name: 'buyrambytes',
    authorization: [{ actor: 'eosio', permission: 'active' }],
    data: bytesToHex(encodeAction(abis.system, 'buyrambytes', { payer: 'eosio', receiver: name, bytes: more }))
  }
  return [base[0], base[1], extra, ...base.slice(2)]
}

/** Whether the target exists on the running local chain and the hash of its code ('' for none). */
export async function copyTarget(target: string, deps: ContractCopyDeps): Promise<ContractCopyTarget> {
  const name = checkName(target, 'target')
  const endpoint = await runningEndpoint(deps.local)
  if (!(await exists(endpoint, name, deps.local))) return { exists: false, hasCode: false, codeHash: '' }
  const codeHash = await codeHashAt(endpoint, name, deps.local)
  return { exists: true, hasCode: codeHash !== '', codeHash }
}

// ---------------------------------------------------------------- B111 points 2-4

/**
 * Copies the code and ABI read from the source (read again when Read was not called or is old) to the
 * target on the local chain. A missing target is created by `eosio` with the chosen vault key; a target
 * with other code is replaced only with `replace`. The deployment is signed from the vault with the normal
 * confirmation. Returns both hashes; the local one is read back from the chain.
 */
export async function copyContract(input: ContractCopyInput, deps: ContractCopyDeps): Promise<ContractCopyResult> {
  const account = checkName(input.account, 'account')
  const target = checkName(input.target, 'target')
  const cached = reads.get(readKey(input.networkId, account))
  const src = cached && deps.now() - cached.at <= READ_TTL_MS ? cached : await readSource({ networkId: input.networkId, account }, deps)
  const sourceHash = sha256Hex(src.wasm)
  const endpoint = await runningEndpoint(deps.local)

  // The target: replace question first, so nothing is created or sent for a refused copy.
  const there = await exists(endpoint, target, deps.local)
  let publicKey = ''
  if (there) {
    const hash = await codeHashAt(endpoint, target, deps.local)
    if (hash !== '' && hash !== sourceHash && !input.replace) throw new Error(replaceText(target))
  } else {
    if (!input.publicKey) throw new Error(`${target} does not exist on the local chain. Choose a key of your vault: the account is made with it.`)
    publicKey = normalizeKey(input.publicKey)
    if (!deps.local.inVault(publicKey)) throw new Error('Choose a key of your vault: the account is controlled only by a key you hold.')
  }

  let created = false
  if (!there) {
    const r = await ready(deps.local)
    const actions = copyAccountActions(target, publicKey, src.wasm.length, {
      system: await readAbi(deps.local, 'eosio.system'),
      token: await readAbi(deps.local, 'eosio.token')
    })
    await sendAsEosio(r, deps.local, actions)
    created = true
    deps.local.star(target)
  }

  const plan = await deps.plan({
    networkId: LOCAL_CHAIN_NETWORK_ID,
    account: target,
    permission: 'active',
    target: 'both',
    bytes: { wasm: src.wasm, abi: src.abi, label: `${src.account} on ${src.network}` }
  })
  // The Deploy dialog's RAM check: an existing target that cannot hold the copy is told so before signing.
  if ((plan.sendWasm || plan.sendAbi) && plan.ramAvailable >= 0 && plan.ramNeeded > plan.ramAvailable) {
    throw new Error(ramShortText(target, plan.ramNeeded, plan.ramAvailable))
  }
  let transactionId: string | null = null
  if (plan.sendWasm || plan.sendAbi) {
    const { networkId, actions } = deps.actions(plan.id)
    const out = await deps.sign(networkId, actions)
    if (out.status === 'cancelled') throw new Error(created ? `${COPY_CANCELLED} ${target} was made on Local chain and has no code.` : COPY_CANCELLED)
    if (out.status === 'failed') throw new Error(out.error)
    transactionId = out.transactionId
  }
  const localHash = await codeHashAt(endpoint, target, deps.local)
  return {
    networkId: input.networkId,
    account,
    target,
    created,
    replaced: plan.chainCodeHash !== '' && plan.sendWasm,
    sourceHash,
    localHash,
    same: localHash === sourceHash,
    transactionId
  }
}

/** For tests: forget every read. */
export function clearReads(): void {
  reads.clear()
}
