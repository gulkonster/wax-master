import { bytesToHex } from './bytes'
import { ChainCoreError } from './errors'
import { abiToBinary, encodeAction, type AbiDef, type AbiFieldDef, type AbiStructDef } from './abi'
import { nameProblem, nameToUint64 } from './name'
import { parsePublicKey, publicKeyToString, type PublicKey } from './keys'
import { parseAsset } from './primitives'
import type { Action, PermissionLevel } from './transaction'

const f = (name: string, type: string): AbiFieldDef => ({ name, type })
const st = (name: string, fields: AbiFieldDef[]): AbiStructDef => ({ name, base: '', fields })
const act = (name: string, type = name): { name: string; type: string; ricardian_contract: string } => ({
  name,
  type,
  ricardian_contract: ''
})

const emptyAbiParts = {
  tables: [],
  ricardian_clauses: [],
  error_messages: [],
  abi_extensions: [],
  variants: [],
  action_results: []
}

/** The parts of the `eosio` system contract ABI that the helpers in this file use. */
export const EOSIO_ABI: AbiDef = {
  version: 'eosio::abi/1.2',
  types: [],
  structs: [
    st('permission_level', [f('actor', 'name'), f('permission', 'name')]),
    st('key_weight', [f('key', 'public_key'), f('weight', 'uint16')]),
    st('permission_level_weight', [f('permission', 'permission_level'), f('weight', 'uint16')]),
    st('wait_weight', [f('wait_sec', 'uint32'), f('weight', 'uint16')]),
    st('authority', [
      f('threshold', 'uint32'),
      f('keys', 'key_weight[]'),
      f('accounts', 'permission_level_weight[]'),
      f('waits', 'wait_weight[]')
    ]),
    st('newaccount', [f('creator', 'name'), f('name', 'name'), f('owner', 'authority'), f('active', 'authority')]),
    st('setcode', [f('account', 'name'), f('vmtype', 'uint8'), f('vmversion', 'uint8'), f('code', 'bytes'), f('memo', 'string$')]),
    st('setabi', [f('account', 'name'), f('abi', 'bytes'), f('memo', 'string$')]),
    st('updateauth', [
      f('account', 'name'),
      f('permission', 'name'),
      f('parent', 'name'),
      f('auth', 'authority'),
      f('authorized_by', 'name$')
    ]),
    st('deleteauth', [f('account', 'name'), f('permission', 'name'), f('authorized_by', 'name$')]),
    st('linkauth', [
      f('account', 'name'),
      f('code', 'name'),
      f('type', 'name'),
      f('requirement', 'name'),
      f('authorized_by', 'name$')
    ]),
    st('unlinkauth', [f('account', 'name'), f('code', 'name'), f('type', 'name'), f('authorized_by', 'name$')]),
    st('buyrambytes', [f('payer', 'name'), f('receiver', 'name'), f('bytes', 'uint32')]),
    st('delegatebw', [
      f('from', 'name'),
      f('receiver', 'name'),
      f('stake_net_quantity', 'asset'),
      f('stake_cpu_quantity', 'asset'),
      f('transfer', 'bool')
    ]),
    st('buyram', [f('payer', 'name'), f('receiver', 'name'), f('quant', 'asset')]),
    st('sellram', [f('account', 'name'), f('bytes', 'int64')]),
    st('undelegatebw', [
      f('from', 'name'),
      f('receiver', 'name'),
      f('unstake_net_quantity', 'asset'),
      f('unstake_cpu_quantity', 'asset')
    ]),
    st('refund', [f('owner', 'name')]),
    st('voteproducer', [f('voter', 'name'), f('proxy', 'name'), f('producers', 'name[]')]),
    st('voterclaim', [f('owner', 'name')]),
    st('claimgbmvote', [f('owner', 'name')]),
    st('claimgenesis', [f('claimer', 'name')]),
    st('powerup', [
      f('payer', 'name'),
      f('receiver', 'name'),
      f('days', 'uint32'),
      f('net_frac', 'int64'),
      f('cpu_frac', 'int64'),
      f('max_payment', 'asset')
    ])
  ],
  actions: [
    act('newaccount'),
    act('setcode'),
    act('setabi'),
    act('updateauth'),
    act('deleteauth'),
    act('linkauth'),
    act('unlinkauth'),
    act('buyrambytes'),
    act('delegatebw'),
    act('buyram'),
    act('sellram'),
    act('undelegatebw'),
    act('refund'),
    act('voteproducer'),
    act('voterclaim'),
    act('claimgbmvote'),
    act('claimgenesis'),
    act('powerup')
  ],
  ...emptyAbiParts
}

/** The parts of the `eosio.token` contract ABI that the helpers in this file use. */
export const EOSIO_TOKEN_ABI: AbiDef = {
  version: 'eosio::abi/1.1',
  types: [],
  structs: [st('transfer', [f('from', 'name'), f('to', 'name'), f('quantity', 'asset'), f('memo', 'string')])],
  actions: [act('transfer')],
  ...emptyAbiParts
}

// ---------------------------------------------------------------- helpers

export interface KeyWeight {
  key: string | PublicKey
  weight: number
}
export interface PermissionLevelWeight {
  permission: PermissionLevel
  weight: number
}
export interface WaitWeight {
  wait_sec: number
  weight: number
}

export interface AuthorityInput {
  threshold: number
  keys?: KeyWeight[]
  accounts?: PermissionLevelWeight[]
  waits?: WaitWeight[]
}

/** Normalized authority as it goes into action data. */
export interface Authority {
  threshold: number
  keys: { key: string; weight: number }[]
  accounts: { permission: PermissionLevel; weight: number }[]
  waits: WaitWeight[]
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

function cmpBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function keyOrder(k: PublicKey): Uint8Array {
  const tag = k.type === 'K1' ? 0 : k.type === 'R1' ? 1 : 2
  const out = new Uint8Array(k.data.length + 1)
  out[0] = tag
  out.set(k.data, 1)
  return out
}

/**
 * Validates an authority and puts keys, accounts and waits in the order the chain requires
 * (keys by type then key bytes, accounts by actor then permission as numbers, waits by seconds).
 * Duplicates are rejected, as is a threshold that the weights can never reach.
 */
export function normalizeAuthority(input: AuthorityInput): Authority {
  const threshold = input.threshold
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 0xffffffff) throw new ChainCoreError('authority.threshold', 'invalid threshold')
  const checkWeight = (w: number, path: string): void => {
    if (!Number.isInteger(w) || w < 0 || w > 0xffff) throw new ChainCoreError(path, 'weight must be an integer from 0 to 65535')
  }
  const keys = (input.keys ?? []).map((k, i) => {
    checkWeight(k.weight, `authority.keys[${i}].weight`)
    const pub = typeof k.key === 'string' ? parsePublicKey(k.key) : k.key
    return { pub, weight: k.weight }
  })
  keys.sort((a, b) => cmpBytes(keyOrder(a.pub), keyOrder(b.pub)))
  for (let i = 1; i < keys.length; i++) {
    if (cmpBytes(keyOrder(keys[i - 1].pub), keyOrder(keys[i].pub)) === 0) throw new ChainCoreError('authority.keys', 'duplicate key')
  }
  const accounts = (input.accounts ?? []).map((a, i) => {
    checkWeight(a.weight, `authority.accounts[${i}].weight`)
    for (const n of [a.permission.actor, a.permission.permission]) {
      const p = nameProblem(n)
      if (p) throw new ChainCoreError(`authority.accounts[${i}].permission`, p)
    }
    return { permission: { actor: a.permission.actor, permission: a.permission.permission }, weight: a.weight }
  })
  accounts.sort(
    (a, b) =>
      cmpBig(nameToUint64(a.permission.actor), nameToUint64(b.permission.actor)) ||
      cmpBig(nameToUint64(a.permission.permission), nameToUint64(b.permission.permission))
  )
  for (let i = 1; i < accounts.length; i++) {
    const a = accounts[i - 1].permission
    const b = accounts[i].permission
    if (a.actor === b.actor && a.permission === b.permission) throw new ChainCoreError('authority.accounts', 'duplicate account permission')
  }
  const waits = (input.waits ?? []).map((w, i) => {
    checkWeight(w.weight, `authority.waits[${i}].weight`)
    if (!Number.isInteger(w.wait_sec) || w.wait_sec < 0 || w.wait_sec > 0xffffffff) {
      throw new ChainCoreError(`authority.waits[${i}].wait_sec`, 'invalid wait')
    }
    return { wait_sec: w.wait_sec, weight: w.weight }
  })
  waits.sort((a, b) => a.wait_sec - b.wait_sec)
  for (let i = 1; i < waits.length; i++) {
    if (waits[i - 1].wait_sec === waits[i].wait_sec) throw new ChainCoreError('authority.waits', 'duplicate wait')
  }
  let total = 0
  for (const k of keys) total += k.weight
  for (const a of accounts) total += a.weight
  for (const w of waits) total += w.weight
  if (total < threshold) throw new ChainCoreError('authority', 'the weights add up to less than the threshold')
  return {
    threshold,
    keys: keys.map((k) => ({ key: publicKeyToString(k.pub, 'new'), weight: k.weight })),
    accounts,
    waits
  }
}

function mk(account: string, name: string, abi: AbiDef, auth: PermissionLevel[], data: unknown): Action {
  return { account, name, authorization: auth, data: bytesToHex(encodeAction(abi, name, data)) }
}

const active = (actor: string): PermissionLevel[] => [{ actor, permission: 'active' }]

export interface TransferArgs {
  from: string
  to: string
  quantity: string
  memo?: string
  /** Token contract; defaults to eosio.token. */
  contract?: string
  authorization?: PermissionLevel[]
}

export function transfer(a: TransferArgs): Action {
  parseAsset(a.quantity)
  return mk(a.contract ?? 'eosio.token', 'transfer', EOSIO_TOKEN_ABI, a.authorization ?? active(a.from), {
    from: a.from,
    to: a.to,
    quantity: a.quantity,
    memo: a.memo ?? ''
  })
}

export function setcode(args: { account: string; code: Uint8Array; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'setcode', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    vmtype: 0,
    vmversion: 0,
    code: bytesToHex(args.code)
  })
}

/** `abi` is either the serialized ABI bytes or an ABI definition, which is serialized here. */
export function setabi(args: { account: string; abi: Uint8Array | AbiDef; authorization?: PermissionLevel[] }): Action {
  const bytes = args.abi instanceof Uint8Array ? args.abi : abiToBinary(args.abi)
  return mk('eosio', 'setabi', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    abi: bytesToHex(bytes)
  })
}

export function updateauth(args: {
  account: string
  permission: string
  parent: string
  auth: AuthorityInput
  authorization?: PermissionLevel[]
}): Action {
  return mk('eosio', 'updateauth', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    permission: args.permission,
    parent: args.parent,
    auth: normalizeAuthority(args.auth)
  })
}

export function deleteauth(args: { account: string; permission: string; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'deleteauth', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    permission: args.permission
  })
}

export function linkauth(args: {
  account: string
  code: string
  type: string
  requirement: string
  authorization?: PermissionLevel[]
}): Action {
  return mk('eosio', 'linkauth', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    code: args.code,
    type: args.type,
    requirement: args.requirement
  })
}

export function unlinkauth(args: { account: string; code: string; type: string; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'unlinkauth', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    code: args.code,
    type: args.type
  })
}

export function newaccount(args: {
  creator: string
  name: string
  owner: AuthorityInput
  active: AuthorityInput
  authorization?: PermissionLevel[]
}): Action {
  return mk('eosio', 'newaccount', EOSIO_ABI, args.authorization ?? active(args.creator), {
    creator: args.creator,
    name: args.name,
    owner: normalizeAuthority(args.owner),
    active: normalizeAuthority(args.active)
  })
}

export function buyrambytes(args: { payer: string; receiver: string; bytes: number; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'buyrambytes', EOSIO_ABI, args.authorization ?? active(args.payer), {
    payer: args.payer,
    receiver: args.receiver,
    bytes: args.bytes
  })
}

export function delegatebw(args: {
  from: string
  receiver: string
  stakeNet: string
  stakeCpu: string
  transfer?: boolean
  authorization?: PermissionLevel[]
}): Action {
  return mk('eosio', 'delegatebw', EOSIO_ABI, args.authorization ?? active(args.from), {
    from: args.from,
    receiver: args.receiver,
    stake_net_quantity: args.stakeNet,
    stake_cpu_quantity: args.stakeCpu,
    transfer: args.transfer ?? false
  })
}

/** Buys RAM for `receiver` worth `quant` of the core token (for example "1.00000000 WAX"). */
export function buyram(args: { payer: string; receiver: string; quant: string; authorization?: PermissionLevel[] }): Action {
  parseAsset(args.quant)
  return mk('eosio', 'buyram', EOSIO_ABI, args.authorization ?? active(args.payer), {
    payer: args.payer,
    receiver: args.receiver,
    quant: args.quant
  })
}

/** Sells `bytes` of the account's own RAM back to the RAM market. */
export function sellram(args: { account: string; bytes: number | bigint; authorization?: PermissionLevel[] }): Action {
  const b = typeof args.bytes === 'bigint' ? args.bytes : Number.isSafeInteger(args.bytes) ? BigInt(args.bytes) : null
  if (b === null || b <= 0n) throw new ChainCoreError('sellram.bytes', 'bytes must be a positive integer')
  return mk('eosio', 'sellram', EOSIO_ABI, args.authorization ?? active(args.account), {
    account: args.account,
    bytes: b
  })
}

/** Unstakes NET and CPU that `from` staked to `receiver`; the tokens come back through a refund after the waiting time. */
export function undelegatebw(args: {
  from: string
  receiver: string
  unstakeNet: string
  unstakeCpu: string
  authorization?: PermissionLevel[]
}): Action {
  parseAsset(args.unstakeNet)
  parseAsset(args.unstakeCpu)
  return mk('eosio', 'undelegatebw', EOSIO_ABI, args.authorization ?? active(args.from), {
    from: args.from,
    receiver: args.receiver,
    unstake_net_quantity: args.unstakeNet,
    unstake_cpu_quantity: args.unstakeCpu
  })
}

/** Claims an unstake refund that is due. */
export function refund(args: { owner: string; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'refund', EOSIO_ABI, args.authorization ?? active(args.owner), { owner: args.owner })
}

/**
 * Votes for producers, or sets a proxy. Give either `producers` or `proxy`, not both.
 * Producers are sorted by name value, as the chain requires; duplicates are rejected.
 */
export function voteproducer(args: {
  voter: string
  proxy?: string
  producers?: string[]
  authorization?: PermissionLevel[]
}): Action {
  const proxy = args.proxy ?? ''
  const producers = [...(args.producers ?? [])]
  if (proxy !== '' && producers.length > 0) throw new ChainCoreError('voteproducer', 'give either a proxy or producers, not both')
  producers.forEach((p, i) => {
    const problem = nameProblem(p)
    if (problem) throw new ChainCoreError(`voteproducer.producers[${i}]`, problem)
  })
  producers.sort((a, b) => cmpBig(nameToUint64(a), nameToUint64(b)))
  for (let i = 1; i < producers.length; i++) {
    if (producers[i - 1] === producers[i]) throw new ChainCoreError('voteproducer.producers', `duplicate producer ${producers[i]}`)
  }
  return mk('eosio', 'voteproducer', EOSIO_ABI, args.authorization ?? active(args.voter), {
    voter: args.voter,
    proxy,
    producers
  })
}

/** Claims voter rewards. */
export function voterclaim(args: { owner: string; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'voterclaim', EOSIO_ABI, args.authorization ?? active(args.owner), { owner: args.owner })
}

/** Claims the GBM voter reward. */
export function claimgbmvote(args: { owner: string; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'claimgbmvote', EOSIO_ABI, args.authorization ?? active(args.owner), { owner: args.owner })
}

/** Claims genesis account tokens. */
export function claimgenesis(args: { claimer: string; authorization?: PermissionLevel[] }): Action {
  return mk('eosio', 'claimgenesis', EOSIO_ABI, args.authorization ?? active(args.claimer), { claimer: args.claimer })
}

/**
 * Rents NET and CPU for `days`. `netFrac` and `cpuFrac` are fractions of the total
 * weight scaled by 10^15; `maxPayment` caps the fee.
 */
export function powerup(args: {
  payer: string
  receiver: string
  days: number
  netFrac: number | bigint | string
  cpuFrac: number | bigint | string
  maxPayment: string
  authorization?: PermissionLevel[]
}): Action {
  parseAsset(args.maxPayment)
  return mk('eosio', 'powerup', EOSIO_ABI, args.authorization ?? active(args.payer), {
    payer: args.payer,
    receiver: args.receiver,
    days: args.days,
    net_frac: args.netFrac,
    cpu_frac: args.cpuFrac,
    max_payment: args.maxPayment
  })
}
