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
// There is no call that signs a digest or arbitrary bytes.

import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import {
  bytesToHex,
  decodeAction,
  encodeAction,
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
import { getNetwork, endpointOf } from './networks'
import { chain, request, RpcError, nodeErrorMessage } from './rpc'
import type { Vault } from './vault'
import { log } from './log'

export const APPROVAL_SECONDS = 120

const SENSITIVE = new Set(['setcode', 'setabi', 'updateauth', 'deleteauth', 'linkauth', 'unlinkauth'])

export interface ActionRequest {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: unknown
}

export interface DeployArtifacts {
  /** Bytes read once by the caller; the same bytes go into setcode/setabi and their hashes are shown. */
  wasm?: Uint8Array
  abi?: Uint8Array
  currentCodeHash?: string
}

export interface PrepareRequest {
  networkId: string
  actions: ActionRequest[]
  /** What the user started, shown as the title of the confirmation. */
  purpose: string
  artifacts?: DeployArtifacts
}

export interface ApprovalAction {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: unknown
  hex: string
}

export interface ApprovalRecord {
  id: string
  purpose: string
  network: { id: string; name: string; kind: string; chainId: string }
  endpoint: string
  expiresAt: number
  expiration: string
  transactionId: string
  packedSha256: string
  actions: ApprovalAction[]
  signers: { actor: string; permission: string; publicKey: string; label: string }[]
  artifacts?: { wasmSha256?: string; wasmSize?: number; abiSha256?: string; abiSize?: number; currentCodeHash?: string }
  /** Account name the user must type (mainnet-like network and a sensitive action). */
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

function isMainnetLike(n: NetworkInfo): boolean {
  return n.kind !== 'testnet' && n.kind !== 'local'
}

export interface SignerDeps {
  vault: Vault
  /** Fixed-endpoint chain calls; replaced in tests. */
  getInfo: (ep: string) => Promise<{ chain_id: string; head_block_id: string; head_block_time: string; last_irreversible_block_id: string }>
  getAbi: (ep: string, account: string) => Promise<AbiDef>
  getAccount: (ep: string, account: string) => Promise<Record<string, unknown>>
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
    send: (ep, body) => request(ep, '/v1/chain/send_transaction', { body, timeoutMs: 30_000 }),
    network: (id) => getNetwork(id),
    now: () => Date.now(),
    mainnetSigning: MAINNET_SIGNING
  }
}

export class Signer {
  private approvals = new Map<string, Stored>()

  constructor(private readonly deps: SignerDeps) {
    deps.vault.onChange((unlocked) => {
      if (!unlocked) this.cancelAll()
    })
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
    // The confirmation shows what the bytes say, decoded back.
    const decoded = unpackTransaction(packed)
    const shown: ApprovalAction[] = []
    for (const a of decoded.actions) {
      const abi = await abiFor(a.account)
      shown.push({
        account: a.account,
        name: a.name,
        authorization: a.authorization,
        data: decodeAction(abi, a.name, hexToBytes(a.data)),
        hex: a.data
      })
    }
    // Keys for every distinct authorization.
    const signers: ApprovalRecord['signers'] = []
    const seen = new Set<string>()
    for (const a of decoded.actions) {
      for (const level of a.authorization) {
        const key = `${level.actor}@${level.permission}`
        if (seen.has(key)) continue
        seen.add(key)
        for (const k of await this.keysFor(endpoint, level)) {
          if (!signers.some((s) => s.publicKey === k.publicKey)) signers.push({ ...level, ...k })
        }
      }
    }
    const art = req.artifacts
    const sensitive = decoded.actions.find((a) => SENSITIVE.has(a.name) && a.account === 'eosio')
    const now = this.deps.now()
    const expiresAt = Math.min(now + APPROVAL_SECONDS * 1000, Date.parse(`${header.expiration}Z`)) - 5000
    const record: ApprovalRecord = {
      id: randomUUID(),
      purpose: req.purpose,
      network: { id: network.id, name: network.name, kind: network.kind, chainId: network.chainId },
      endpoint,
      expiresAt,
      expiration: header.expiration,
      transactionId: transactionId(packed),
      packedSha256: sha256Hex(packed),
      actions: shown,
      signers,
      artifacts: art
        ? {
            wasmSha256: art.wasm ? sha256Hex(art.wasm) : undefined,
            wasmSize: art.wasm?.length,
            abiSha256: art.abi ? sha256Hex(art.abi) : undefined,
            abiSize: art.abi?.length,
            currentCodeHash: art.currentCodeHash
          }
        : undefined,
      typedName: isMainnetLike(network) && sensitive ? (sensitive.authorization[0]?.actor ?? sensitive.account) : undefined,
      blocked:
        isMainnetLike(network) && !this.deps.mainnetSigning
          ? 'Mainnet signing unlocks in the release build. This build signs on testnet and local networks only.'
          : undefined
    }
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
      if (e instanceof RpcError) throw new SignerError(nodeErrorMessage(e.details, e.message), e.details)
      throw e
    }
  }
}

