// The signer: the only code that reaches decrypted keys.
//
//   prepare(request)  builds the transaction with the chain core, decodes the
//                     packed bytes back for display and stores an immutable
//                     approval record (bytes, chain id, endpoint, keys).
//   approve(id, secret, typedName)
//                     signs exactly the stored bytes and sends them to exactly
//                     the stored endpoint. Single use; expires with the
//                     transaction. The secret is held only by the
//                     confirmation window's handler, so the editor window
//                     cannot approve.
//   cancel(id)        drops an approval.
//
// There is no call that signs a digest or arbitrary bytes. Everything the
// confirmation shows (title, typed name, code and ABI hashes) is derived here
// from the packed bytes, never taken from the caller.

import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import {
  bytesToHex,
  decodeAction,
  encodeAction,
  EOSIO_ABI,
  headerFromChainInfo,
  hexToBytes,
  packTransaction,
  parseAbi,
  parsePublicKey,
  publicKeyToString,
  recoverPublicKey,
  signDigest,
  signatureToString,
  signingDigest,
  transactionId,
  unpackTransaction,
  type AbiDef,
  type PermissionLevel
} from '../chain-core'
import type { NetworkInfo } from '../shared/chain-types'
import { MAINNET_SIGNING } from './build-info'
import { getNetwork, endpointOf, effectiveKind } from './networks'
import { chain, request, RpcError, nodeErrorMessage } from './rpc'
import type { Vault } from './vault'
import { log } from './log'
import { LOCKED_MESSAGE } from '../shared/vault-locked'

export const APPROVAL_SECONDS = 120

/** System actions that need the typed account name on mainnet-like networks. */
const SENSITIVE = new Set(['setcode', 'setabi', 'updateauth', 'deleteauth', 'linkauth', 'unlinkauth'])

/** The typed locked-vault error: the editor asks for the password in place and repeats the request. */
export { LOCKED_MESSAGE }
export const BUSY_MESSAGE = 'Another confirmation is open. Approve or cancel it first.'

export interface ActionRequest {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: unknown
}

/**
 * What the main process started; picks the fixed title of the confirmation.
 * Set by main-process code only (never taken from the editor window).
 */
export type PrepareKind = 'run' | 'deploy' | 'clearCode' | 'createAccount' | 'changeKey'

export interface PrepareRequest {
  networkId: string
  actions: ActionRequest[]
  kind?: PrepareKind
}

export interface ApprovalAction {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: unknown
  hex: string
  /** For setcode / setabi: size and SHA-256 of the code or ABI bytes inside this action. */
  blob?: { field: 'code' | 'abi'; size: number; sha256: string }
}

export interface ApprovalRecord {
  id: string
  /** Headline of the confirmation, made here from the decoded actions. */
  title: string
  network: { id: string; name: string; kind: string; chainId: string }
  endpoint: string
  expiresAt: number
  expiration: string
  transactionId: string
  packedSha256: string
  actions: ApprovalAction[]
  signers: { actor: string; permission: string; publicKey: string; label: string }[]
  /** Contract code and ABI in this transaction, from the packed bytes; code on the account read in prepare. */
  artifacts?: {
    account: string
    wasmSha256?: string
    wasmSize?: number
    abiSha256?: string
    abiSize?: number
    /** '' = no code on the account; null = could not be read from the endpoint. */
    currentCodeHash: string | null
    /** The transaction removes the contract (empty setcode). */
    clear: boolean
  }
  /** Account name the user must type in the confirmation window. */
  typedName?: string
  /** Signing on this network is switched off in this build. */
  blocked?: string
}

interface Stored {
  record: ApprovalRecord
  secret: Buffer
  packed: Uint8Array
  chainId: string
  endpoint: string
  keys: string[]
  used: boolean
}

export interface SendResult {
  transactionId: string
  response: unknown
}

export class SignerError extends Error {
  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super(message)
  }
}

function sha256Hex(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex')
}

/** Mainnet, or any network the kind rule (networks.effectiveKind) does not treat as test or local. */
export function isMainnetLike(n: NetworkInfo): boolean {
  return effectiveKind(n) === 'mainnet'
}

export interface SignerDeps {
  vault: Vault
  /** Fixed-endpoint chain calls; replaced in tests. */
  getInfo: (ep: string) => Promise<{ chain_id: string; head_block_id: string; head_block_time: string; last_irreversible_block_id: string }>
  getAbi: (ep: string, account: string) => Promise<AbiDef>
  getAccount: (ep: string, account: string) => Promise<Record<string, unknown>>
  /** Hash of the code now on the account ('' or zeros when there is none). */
  getCodeHash: (ep: string, account: string) => Promise<string>
  send: (ep: string, body: unknown) => Promise<unknown>
  network: (id: string) => NetworkInfo
  now: () => number
  mainnetSigning: boolean
}

export function defaultDeps(vault: Vault): SignerDeps {
  return {
    vault,
    getInfo: (ep) => chain.getInfo(ep),
    getAbi: async (ep, account) => {
      const r = await chain.getAbi(ep, account)
      if (!r.abi) throw new SignerError(`The account ${account} has no contract (no ABI)`)
      return parseAbi(r.abi)
    },
    getAccount: (ep, account) => chain.getAccount(ep, account),
    getCodeHash: async (ep, account) => (await chain.getCodeHash(ep, account)).code_hash,
    // A send that failed on a broken keep-alive connection, before any answer
    // came, is sent once more to the same endpoint (rpc.request, retryStale).
    // This cannot run the transaction twice: the second attempt carries the
    // same signed bytes, so the same transaction id, and the chain accepts a
    // transaction id only once. If the first attempt did reach the node, the
    // repeat is refused as a duplicate, and approve() says so plainly.
    send: (ep, body) => request(ep, '/v1/chain/send_transaction', { body, timeoutMs: 30_000 }),
    network: (id) => getNetwork(id),
    now: () => Date.now(),
    mainnetSigning: MAINNET_SIGNING
  }
}

interface Decoded {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: string
}

/** The node's answer to a transaction id it already has (tx_duplicate, code 3040008). */
function isDuplicate(details: unknown): boolean {
  const err = (details as { error?: { code?: unknown; name?: unknown } } | null)?.error
  return !!err && (err.code === 3040008 || err.name === 'tx_duplicate')
}

/** Decodes a system action with the built-in eosio ABI (independent of what the endpoint serves). */
function systemData(a: Decoded): Record<string, unknown> {
  try {
    return decodeAction(EOSIO_ABI, a.name, hexToBytes(a.data)) as Record<string, unknown>
  } catch (e) {
    throw new SignerError(`The ${a.account}::${a.name} action could not be read: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function isSystem(a: Decoded, name: string): boolean {
  return a.account === 'eosio' && a.name === name
}

/** Fixed headline for what the main process started, from the decoded actions. */
function titleFor(kind: PrepareKind, actions: Decoded[], guarded: string | null): string {
  const find = (name: string): Decoded | undefined => actions.find((a) => isSystem(a, name))
  if (kind === 'deploy' && guarded && (find('setcode') || find('setabi'))) return `Deploy contract to ${guarded}`
  if (kind === 'clearCode' && guarded && find('setcode')) return `Clear contract code of ${guarded}`
  if (kind === 'createAccount') {
    const n = find('newaccount')
    if (n) return `Create account ${String(systemData(n).name)}`
  }
  if (kind === 'changeKey') {
    const u = find('updateauth')
    if (u) {
      const d = systemData(u)
      return `Change key of ${String(d.account)}@${String(d.permission)}`
    }
  }
  if (actions.length === 1) return `Run ${actions[0].account}::${actions[0].name}`
  return `${actions.length} actions`
}

export class Signer {
  private approvals = new Map<string, Stored>()
  private preparing = false

  constructor(private readonly deps: SignerDeps) {
    deps.vault.onChange((unlocked) => {
      if (!unlocked) this.cancelAll()
    })
  }

  /** True while an approval exists (its confirmation window is open) or one is being prepared. */
  busy(): boolean {
    return this.preparing || this.approvals.size > 0
  }

  /** Picks vault keys that satisfy actor@permission on the given endpoint. */
  private async keysFor(endpoint: string, level: PermissionLevel): Promise<{ publicKey: string; label: string }[]> {
    const account = await this.deps.getAccount(endpoint, level.actor)
    const perms = Array.isArray(account.permissions) ? (account.permissions as Record<string, unknown>[]) : []
    const perm = perms.find((p) => p.perm_name === level.permission)
    if (!perm) throw new SignerError(`The account ${level.actor} has no permission "${level.permission}"`)
    const auth = (perm.required_auth ?? {}) as { threshold?: number; keys?: { key: string; weight: number }[] }
    const threshold = Number(auth.threshold ?? 1)
    const vaultKeys = this.deps.vault.list()
    const chosen: { publicKey: string; label: string }[] = []
    let weight = 0
    for (const k of auth.keys ?? []) {
      let normalized: string
      try {
        normalized = publicKeyToString(parsePublicKey(k.key), 'new')
      } catch {
        continue
      }
      const v = vaultKeys.find((x) => x.publicKey === normalized)
      if (v) {
        chosen.push({ publicKey: v.publicKey, label: v.label })
        weight += Number(k.weight)
        if (weight >= threshold) return chosen
      }
    }
    throw new SignerError(
      `The vault has no key that can sign for ${level.actor}@${level.permission} (threshold ${threshold}). Import the key in Manage Keypairs.`
    )
  }

  async prepare(req: PrepareRequest): Promise<{ record: ApprovalRecord; secret: Buffer }> {
    if (!this.deps.vault.isUnlocked()) throw new SignerError(LOCKED_MESSAGE)
    if (this.busy()) throw new SignerError(BUSY_MESSAGE)
    this.preparing = true
    try {
      return await this.build(req)
    } finally {
      this.preparing = false
    }
  }

  private async build(req: PrepareRequest): Promise<{ record: ApprovalRecord; secret: Buffer }> {
    const network = this.deps.network(req.networkId)
    const endpoint = endpointOf(network)
    if (req.actions.length === 0) throw new SignerError('Nothing to sign')
    const info = await this.deps.getInfo(endpoint)
    if (info.chain_id !== network.chainId) {
      throw new SignerError(
        `The endpoint ${endpoint} reports chain id ${info.chain_id}, but ${network.name} is ${network.chainId}. Nothing was prepared.`
      )
    }
    // Encode every action with its contract's ABI.
    const abis = new Map<string, AbiDef>()
    const abiFor = async (account: string): Promise<AbiDef> => {
      let a = abis.get(account)
      if (!a) {
        a = await this.deps.getAbi(endpoint, account)
        abis.set(account, a)
      }
      return a
    }
    const actions = []
    for (const a of req.actions) {
      const abi = await abiFor(a.account)
      const data = encodeAction(abi, a.name, a.data)
      actions.push({ account: a.account, name: a.name, authorization: a.authorization, data: bytesToHex(data) })
    }
    const header = headerFromChainInfo(info, APPROVAL_SECONDS)
    const packed = packTransaction({ ...header, actions })
    // Everything below is read from the bytes, decoded back.
    const decoded = unpackTransaction(packed).actions as Decoded[]
    const shown: ApprovalAction[] = []
    for (const a of decoded) {
      const abi = await abiFor(a.account)
      const item: ApprovalAction = {
        account: a.account,
        name: a.name,
        authorization: a.authorization,
        data: decodeAction(abi, a.name, hexToBytes(a.data)),
        hex: a.data
      }
      if (isSystem(a, 'setcode') || isSystem(a, 'setabi')) {
        const field = a.name === 'setcode' ? 'code' : 'abi'
        const bytes = hexToBytes(String(systemData(a)[field] ?? ''))
        item.blob = { field, size: bytes.length, sha256: sha256Hex(bytes) }
      }
      shown.push(item)
    }

    // Guarded system actions: the account they change is the `account` field of their data.
    const guardedActions = decoded.filter((a) => a.account === 'eosio' && SENSITIVE.has(a.name))
    const guardedAccounts = [...new Set(guardedActions.map((a) => String(systemData(a).account ?? '')))]
    if (guardedAccounts.some((x) => !x)) throw new SignerError('A guarded system action has no account; nothing was prepared.')
    if (guardedAccounts.length > 1) {
      throw new SignerError(
        `This transaction changes more than one account (${guardedAccounts.join(', ')}) with deploy or permission actions. Send one transaction per account.`
      )
    }
    const guarded = guardedAccounts[0] ?? null
    const clear = decoded.some((a) => isSystem(a, 'setcode') && String(systemData(a).code ?? '') === '')

    // Keys for every distinct authorization.
    const signers: ApprovalRecord['signers'] = []
    const seen = new Set<string>()
    for (const a of decoded) {
      for (const level of a.authorization) {
        const key = `${level.actor}@${level.permission}`
        if (seen.has(key)) continue
        seen.add(key)
        for (const k of await this.keysFor(endpoint, level)) {
          if (!signers.some((s) => s.publicKey === k.publicKey)) signers.push({ ...level, ...k })
        }
      }
    }

    // Contract code and ABI, from the bytes in this transaction; the code on the account from this endpoint, now.
    let artifacts: ApprovalRecord['artifacts']
    const code = shown.find((a) => a.blob?.field === 'code')?.blob
    const abiBlob = shown.find((a) => a.blob?.field === 'abi')?.blob
    if (guarded && (code || abiBlob)) {
      let currentCodeHash: string | null
      try {
        const h = await this.deps.getCodeHash(endpoint, guarded)
        currentCodeHash = /^0*$/.test(h) ? '' : h
      } catch {
        currentCodeHash = null
      }
      artifacts = {
        account: guarded,
        wasmSha256: code?.sha256,
        wasmSize: code?.size,
        abiSha256: abiBlob?.sha256,
        abiSize: abiBlob?.size,
        currentCodeHash,
        clear
      }
    }

    const mainnetLike = isMainnetLike(network)
    const now = this.deps.now()
    const expiresAt = Math.min(now + APPROVAL_SECONDS * 1000, Date.parse(`${header.expiration}Z`)) - 5000
    const record: ApprovalRecord = {
      id: randomUUID(),
      title: titleFor(req.kind ?? 'run', decoded, guarded),
      network: { id: network.id, name: network.name, kind: effectiveKind(network), chainId: network.chainId },
      endpoint,
      expiresAt,
      expiration: header.expiration,
      transactionId: transactionId(packed),
      packedSha256: sha256Hex(packed),
      actions: shown,
      signers,
      artifacts,
      // Mainnet-like: every guarded action. Clear Contract Code: on every network.
      typedName: guarded && (mainnetLike || clear) ? guarded : undefined,
      blocked:
        mainnetLike && !this.deps.mainnetSigning
          ? 'Mainnet signing unlocks in the release build. This build signs on testnet and local networks only.'
          : undefined
    }
    if (this.approvals.size > 0) throw new SignerError(BUSY_MESSAGE)
    const secret = randomBytes(32)
    this.approvals.set(record.id, {
      record,
      secret,
      packed,
      chainId: network.chainId,
      endpoint,
      keys: signers.map((s) => s.publicKey),
      used: false
    })
    return { record, secret }
  }

  get(id: string): ApprovalRecord | null {
    return this.approvals.get(id)?.record ?? null
  }

  cancel(id: string): void {
    const s = this.approvals.get(id)
    if (s) s.secret.fill(0)
    this.approvals.delete(id)
  }

  cancelAll(): void {
    for (const id of [...this.approvals.keys()]) this.cancel(id)
  }

  async approve(id: string, secret: Buffer, typedName?: string): Promise<SendResult> {
    const s = this.approvals.get(id)
    if (!s) throw new SignerError('This approval is no longer valid. Start the action again.')
    if (s.secret.length !== secret.length || !timingSafeEqual(s.secret, secret)) {
      throw new SignerError('Approval refused')
    }
    if (s.used) throw new SignerError('This approval was already used')
    s.used = true
    this.approvals.delete(id)
    if (this.deps.now() > s.record.expiresAt) throw new SignerError('This approval has expired. Start the action again.')
    if (s.record.blocked) throw new SignerError(s.record.blocked)
    if (s.record.typedName && typedName !== s.record.typedName) {
      throw new SignerError(`Type the account name "${s.record.typedName}" to confirm`)
    }
    const digest = signingDigest(s.chainId, s.packed)
    const signatures: string[] = []
    for (const pub of s.keys) {
      const sig = this.deps.vault.withPrivateKey(pub, (priv) => signDigest(digest, priv))
      const recovered = publicKeyToString(recoverPublicKey(digest, sig), 'new')
      if (recovered !== pub) throw new SignerError('Signature check failed; nothing was sent')
      signatures.push(signatureToString(sig))
    }
    const body = { signatures, compression: 0, packed_context_free_data: '', packed_trx: bytesToHex(s.packed) }
    try {
      const response = await this.deps.send(s.endpoint, body)
      log.info(`Transaction ${s.record.transactionId} sent to ${s.endpoint}`)
      return { transactionId: s.record.transactionId, response }
    } catch (e) {
      if (e instanceof RpcError && isDuplicate(e.details)) {
        throw new SignerError(
          `The node already has transaction ${s.record.transactionId}: an earlier attempt of this send reached it. Check the transaction in the history before sending again.`,
          e.details
        )
      }
      // No answer at all (also a time limit): the transaction may have arrived before the connection broke.
      if (e instanceof RpcError && e.status === 0) {
        throw new SignerError(
          `${e.message} The transaction ${s.record.transactionId} may still have reached the node. Open it in the history (or look at the account) before sending again.`
        )
      }
      if (e instanceof RpcError) throw new SignerError(nodeErrorMessage(e.details, e.message), e.details)
      throw e
    }
  }
}
