import { sha256 } from '@noble/hashes/sha2.js'
import { SerialBuffer, bytesToHex, concatBytes, hexToBytes } from './bytes'
import { ChainCoreError } from './errors'
import { decodeAction, decodeType, encodeAction, encodeType, type AbiDef, type AbiLike, type DecodeOptions } from './abi'

export interface PermissionLevel {
  actor: string
  permission: string
}

/** An action as it appears in a transaction: `data` is the serialized action data as hex. */
export interface Action {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: string
}

export interface TransactionExtension {
  type: number
  data: string
}

export interface TransactionHeader {
  expiration: string
  ref_block_num: number
  ref_block_prefix: number
  max_net_usage_words: number
  max_cpu_usage_ms: number
  delay_sec: number
}

export interface Transaction extends TransactionHeader {
  context_free_actions: Action[]
  actions: Action[]
  transaction_extensions: TransactionExtension[]
}

/** ABI describing the packed transaction layout. */
export const TRANSACTION_ABI: AbiDef = {
  version: 'eosio::abi/1.1',
  types: [],
  structs: [
    {
      name: 'permission_level',
      base: '',
      fields: [
        { name: 'actor', type: 'name' },
        { name: 'permission', type: 'name' }
      ]
    },
    {
      name: 'action',
      base: '',
      fields: [
        { name: 'account', type: 'name' },
        { name: 'name', type: 'name' },
        { name: 'authorization', type: 'permission_level[]' },
        { name: 'data', type: 'bytes' }
      ]
    },
    {
      name: 'extension',
      base: '',
      fields: [
        { name: 'type', type: 'uint16' },
        { name: 'data', type: 'bytes' }
      ]
    },
    {
      name: 'transaction_header',
      base: '',
      fields: [
        { name: 'expiration', type: 'time_point_sec' },
        { name: 'ref_block_num', type: 'uint16' },
        { name: 'ref_block_prefix', type: 'uint32' },
        { name: 'max_net_usage_words', type: 'varuint32' },
        { name: 'max_cpu_usage_ms', type: 'uint8' },
        { name: 'delay_sec', type: 'varuint32' }
      ]
    },
    {
      name: 'transaction',
      base: 'transaction_header',
      fields: [
        { name: 'context_free_actions', type: 'action[]' },
        { name: 'actions', type: 'action[]' },
        { name: 'transaction_extensions', type: 'extension[]' }
      ]
    }
  ],
  actions: [],
  tables: [],
  ricardian_clauses: [],
  error_messages: [],
  abi_extensions: []
}

export type TransactionInput = Omit<Transaction, 'context_free_actions' | 'transaction_extensions' | 'max_net_usage_words' | 'max_cpu_usage_ms' | 'delay_sec'> &
  Partial<Pick<Transaction, 'context_free_actions' | 'transaction_extensions' | 'max_net_usage_words' | 'max_cpu_usage_ms' | 'delay_sec'>>

/** Serializes a transaction. Missing optional header fields and lists default to zero / empty. */
export function packTransaction(trx: TransactionInput): Uint8Array {
  const full = {
    max_net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0,
    context_free_actions: [],
    transaction_extensions: [],
    ...trx
  }
  return encodeType(TRANSACTION_ABI, 'transaction', full, 'transaction')
}

export function unpackTransaction(bytes: Uint8Array | string): Transaction {
  const raw = typeof bytes === 'string' ? hexToBytes(bytes) : bytes
  return decodeType(TRANSACTION_ABI, 'transaction', raw, { path: 'transaction' }) as Transaction
}

/** Transaction id: hex sha256 of the packed transaction. */
export function transactionId(packed: Uint8Array): string {
  return bytesToHex(sha256(packed))
}

/**
 * Digest that gets signed: sha256(chainId || packed transaction || sha256(context free data)),
 * with 32 zero bytes in place of the last part when there is no context free data.
 * `contextFreeData` is the serialized `bytes[]` that goes with the transaction.
 */
export function signingDigest(chainIdHex: string, packedTrx: Uint8Array, contextFreeData?: Uint8Array): Uint8Array {
  const chainId = hexToBytes(chainIdHex)
  if (chainId.length !== 32) throw new ChainCoreError('', 'chain id must be 32 bytes')
  const cfd = contextFreeData && contextFreeData.length > 0 ? sha256(contextFreeData) : new Uint8Array(32)
  return sha256(concatBytes(chainId, packedTrx, cfd))
}

/** Serializes context free data entries as the `bytes[]` hashed into the signing digest. */
export function packContextFreeData(entries: Uint8Array[]): Uint8Array {
  const buf = new SerialBuffer()
  buf.pushVaruint32(entries.length)
  for (const e of entries) buf.pushVarBytes(e)
  return buf.asUint8Array()
}

/** The fields of `get_info` or `get_block` that are needed to build a transaction header. */
export interface ChainInfoLike {
  head_block_time?: string
  head_block_id?: string
  last_irreversible_block_id?: string
  /** get_block / get_block_info fields */
  id?: string
  timestamp?: string
}

function parseTimeSeconds(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/.exec(s)
  if (!m) throw new ChainCoreError('', `invalid time "${s}"`)
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number)
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, sec) / 1000)
}

/**
 * Builds the transaction header fields from chain info. With `get_info` output the reference block is
 * the last irreversible block (set `useHead` to use the head block); with a block (`id`, `timestamp`)
 * that block is the reference. Expiration is the chain time plus `expireSeconds`.
 */
export function headerFromChainInfo(info: ChainInfoLike, expireSeconds: number, useHead = false): TransactionHeader {
  if (!Number.isInteger(expireSeconds) || expireSeconds < 1) throw new ChainCoreError('', 'expireSeconds must be a positive integer')
  const idHex = info.id ?? (useHead ? info.head_block_id : info.last_irreversible_block_id) ?? info.last_irreversible_block_id ?? info.head_block_id
  const time = info.timestamp ?? info.head_block_time
  if (!idHex || !time) throw new ChainCoreError('', 'chain info is missing the block id or time')
  const id = hexToBytes(idHex)
  if (id.length !== 32) throw new ChainCoreError('', 'block id must be 32 bytes')
  // block number is the first 4 bytes, big endian; the prefix is bytes 8..12, little endian
  const blockNum = ((id[0] << 24) | (id[1] << 16) | (id[2] << 8) | id[3]) >>> 0
  const prefix = (id[8] | (id[9] << 8) | (id[10] << 16) | (id[11] << 24)) >>> 0
  const expiration = new Date((parseTimeSeconds(time) + expireSeconds) * 1000).toISOString().slice(0, 19)
  return {
    expiration,
    ref_block_num: blockNum & 0xffff,
    ref_block_prefix: prefix,
    max_net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0
  }
}

/** Builds an action, serializing `data` with the contract ABI. */
export function buildAction(abi: AbiLike, account: string, name: string, authorization: PermissionLevel[], data: unknown): Action {
  return { account, name, authorization, data: bytesToHex(encodeAction(abi, name, data)) }
}

/** Decodes the hex `data` of an action with the contract ABI. */
export function decodeActionData(abi: AbiLike, action: Pick<Action, 'name' | 'data'>, opts?: DecodeOptions): unknown {
  return decodeAction(abi, action.name, hexToBytes(action.data), opts)
}
