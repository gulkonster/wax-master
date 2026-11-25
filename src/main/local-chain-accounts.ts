// New account and Give tokens on the app's local chain (decision B109 points 3-5). Both are sent by the
// chain's own `eosio` account and signed here with its system key, without the vault and without a
// confirmation window. Every send first passes the guard of B109 point 3. The key is never logged and never
// put in a result or an error text.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EOSIO_ABI,
  bytesToHex,
  encodeAction,
  headerFromChainInfo,
  normalizeAuthority,
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
import { LOCAL_CHAIN_NETWORK_ID, type LocalAccountInput, type LocalChainStatus, type LocalTokensInput } from '../shared/local-chain'
import type { LocalAccountResult, LocalTokensResult } from '../shared/api'
import { assertLocalChain } from './local-chain-boot'
import { request, type ChainInfo } from './rpc'
import { resourcesDir } from './paths'
import * as chain from './local-chain'
import * as networks from './networks'
import { vault } from './keys-service'
import { sentStore } from './sent-store'
import { log } from './log'

export const LOCAL_ACCOUNT_RAM_BYTES = 1_048_576
export const LOCAL_ACCOUNT_STAKE = '100.00000000 WAX'
export const LOCAL_ACCOUNT_TOKENS = '10000.00000000 WAX'
export const LOCAL_TOKENS_MAX = 1_000_000

/** The 12-character names of Create Account (a-z, 1-5, dots inside). */
const NEW_NAME = /^[a-z1-5][a-z1-5.]{10}[a-z1-5]$/
const ANY_NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

export const NOT_RUNNING_TEXT = 'The local chain is not running. Start it in Network > Local Chain.'

export interface LocalAccountsDeps {
  status: () => Promise<LocalChainStatus>
  systemKey: () => Promise<string>
  /** POST `body` as JSON; throws with the node's message on an error answer. */
  request: <T>(endpoint: string, path: string, body: unknown, timeoutMs?: number) => Promise<T>
  readResource: (relativePath: string) => Promise<Buffer>
  /** Whether the vault holds this public key (no unlock needed). */
  inVault: (publicKey: string) => boolean
  /** Stars the account on the network `local-chain`. */
  star: (account: string) => void
  /** Keeps the node's answer of an accepted send for Open Transaction by Id; may fail without failing the send. */
  keep: (id: string, actions: Action[], endpoint: string, answer: unknown) => void
}


function normalizeKey(k: string): string {
  try {
    return publicKeyToString(parsePublicKey(k.trim()), 'new')
  } catch {
    throw new Error(`Not a valid public key: ${k}`)
  }
}

/** The amount as a WAX quantity with 8 decimals; throws when it is not more than 0 and at most 1,000,000. */
export function tokenQuantity(amount: number): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount of WAX greater than 0.')
  if (amount > LOCAL_TOKENS_MAX) throw new Error('At most 1,000,000 WAX at a time.')
  const units = Math.round(amount * 1e8)
  if (units <= 0) throw new Error('Enter an amount of WAX greater than 0.')
  return `${(units / 1e8).toFixed(8)} WAX`
}

export function checkNewName(name: string): string {
  if (typeof name !== 'string' || !NEW_NAME.test(name)) throw new Error('The name must be 12 characters: a-z and 1-5.')
  return name
}

function encode(abi: AbiDef, account: string, name: string, data: unknown): Action {
  return { account, name, authorization: [{ actor: 'eosio', permission: 'active' }], data: bytesToHex(encodeAction(abi, name, data)) }
}

/** The four actions of B109 point 4, all by `eosio`. */
export function newAccountActions(name: string, publicKey: string, abis: { system: AbiDef; token: AbiDef }, codePermission = false): Action[] {
  const key = normalizeKey(publicKey)
  const auth = normalizeAuthority({ threshold: 1, keys: [{ key, weight: 1 }] })
  // A copy of a contract whose source has eosio.code gets it on active too (B132 (b)); owner stays the key alone.
  const active = codePermission
    ? normalizeAuthority({ threshold: 1, keys: [{ key, weight: 1 }], accounts: [{ permission: { actor: name, permission: 'eosio.code' }, weight: 1 }] })
    : auth
  return [
    encode(EOSIO_ABI, 'eosio', 'newaccount', { creator: 'eosio', name, owner: auth, active }),
    encode(abis.system, 'eosio', 'buyrambytes', { payer: 'eosio', receiver: name, bytes: LOCAL_ACCOUNT_RAM_BYTES }),
    encode(abis.system, 'eosio', 'delegatebw', {
      from: 'eosio',
      receiver: name,
      stake_net_quantity: LOCAL_ACCOUNT_STAKE,
      stake_cpu_quantity: LOCAL_ACCOUNT_STAKE,
      transfer: true
    }),
    encode(abis.token, 'eosio.token', 'transfer', { from: 'eosio', to: name, quantity: LOCAL_ACCOUNT_TOKENS, memo: '' })
  ]
}

export function giveTokensActions(account: string, quantity: string, token: AbiDef): Action[] {
  return [encode(token, 'eosio.token', 'transfer', { from: 'eosio', to: account, quantity, memo: '' })]
}

// ---------------------------------------------------------------- sending

const defaultRequest = <T>(endpoint: string, path: string, body: unknown, timeoutMs?: number): Promise<T> =>
  request<T>(endpoint, path, { body, timeoutMs: timeoutMs ?? 30_000, retryStale: false })

export function defaultLocalAccountsDeps(): LocalAccountsDeps {
  return {
    status: () => chain.getStatus(),
    systemKey: () => chain.localChainSystemKey(),
    request: defaultRequest,
    readResource: (rel) => readFile(join(resourcesDir(), 'local-chain', ...rel.split('/'))),
    inVault: (publicKey) => {
      const want = normalizeKey(publicKey)
      return vault()
        .list()
        .some((k) => {
          try {
            return normalizeKey(k.publicKey) === want
          } catch {
            return false
          }
        })
    },
    star: (account) => {
      networks.setStar(LOCAL_CHAIN_NETWORK_ID, account, true)
    },
    keep: (id, actions, endpoint, answer) => {
      let network = 'Local chain'
      try {
        network = networks.getNetwork(LOCAL_CHAIN_NETWORK_ID).name
      } catch {
        // the entry is missing: the usual name is kept
      }
      sentStore().keep(
        LOCAL_CHAIN_NETWORK_ID,
        id,
        { network, endpoint, first: actions[0] ? `${actions[0].account}::${actions[0].name}` : '', count: actions.length },
        answer
      )
    }
  }
}

/** Keeps the answer of an accepted send by `eosio`; a failure is logged and never fails the call. */
export function keepSent(deps: LocalAccountsDeps, id: string, actions: Action[], endpoint: string, answer: unknown): void {
  try {
    deps.keep(id, actions, endpoint, answer)
  } catch (e) {
    log.warn(`Answer of transaction ${id} not kept: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
}

interface Ready {
  endpoint: string
  chainId: string
  key: string
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

async function send(r: Ready, deps: LocalAccountsDeps, actions: Action[]): Promise<string> {
  const info = await deps.request<ChainInfo>(r.endpoint, '/v1/chain/get_info', {})
  const packed = packTransaction({ ...headerFromChainInfo(info, 120, true), actions })
  const sig = signDigest(signingDigest(r.chainId, packed), parsePrivateKey(r.key))
  const body = { signatures: [signatureToString(sig)], compression: 0, packed_context_free_data: '', packed_trx: bytesToHex(packed) }
  const answer = await deps.request<unknown>(r.endpoint, '/v1/chain/send_transaction', body, 60_000)
  const id = transactionId(packed)
  keepSent(deps, id, actions, r.endpoint, answer)
  return id
}

async function exists(endpoint: string, name: string, deps: LocalAccountsDeps): Promise<boolean> {
  try {
    await deps.request(endpoint, '/v1/chain/get_account', { account_name: name })
    return true
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e)
    if (/unknown key|unknown_account|account_query_exception|does not exist/i.test(text)) return false
    throw e
  }
}

async function readAbi(deps: LocalAccountsDeps, contract: 'eosio.system' | 'eosio.token'): Promise<AbiDef> {
  try {
    return parseAbi(JSON.parse((await deps.readResource(`contracts/${contract}.abi`)).toString('utf8')))
  } catch {
    throw new Error(`The contract files of ${contract} are missing from the app's resources`)
  }
}

// ---------------------------------------------------------------- the calls

/** Whether the name exists on the running local chain ("free" check of the dialog). */
export async function localAccountExists(name: string, deps: LocalAccountsDeps = defaultLocalAccountsDeps()): Promise<boolean> {
  if (!ANY_NAME.test(name)) throw new Error('account: not a valid account name')
  const s = await deps.status()
  if (s.phase !== 'running') throw new Error(NOT_RUNNING_TEXT)
  return exists(s.endpoint, name, deps)
}

/** B109 point 4: `newaccount`, `buyrambytes` 1 MiB, `delegatebw` 100/100 WAX with transfer, `transfer` 10,000 WAX; then the star. */
export async function createLocalAccount(input: LocalAccountInput, deps: LocalAccountsDeps = defaultLocalAccountsDeps()): Promise<LocalAccountResult> {
  const name = checkNewName(input.name)
  const publicKey = normalizeKey(input.publicKey)
  if (!deps.inVault(publicKey)) throw new Error('Choose a key of your vault: the account is controlled only by a key you hold.')
  const r = await ready(deps)
  if (await exists(r.endpoint, name, deps)) throw new Error('This name is taken on Local chain.')
  const actions = newAccountActions(name, publicKey, { system: await readAbi(deps, 'eosio.system'), token: await readAbi(deps, 'eosio.token') })
  const id = await send(r, deps, actions)
  deps.star(name)
  return { account: name, transactionId: id }
}

/** B109 point 5: WAX from `eosio` to an existing account of the local chain. */
export async function giveLocalTokens(input: LocalTokensInput, deps: LocalAccountsDeps = defaultLocalAccountsDeps()): Promise<LocalTokensResult> {
  if (typeof input.account !== 'string' || !ANY_NAME.test(input.account) || !input.account) throw new Error('account: not a valid account name')
  const quantity = tokenQuantity(input.amount)
  const r = await ready(deps)
  if (!(await exists(r.endpoint, input.account, deps))) throw new Error(`The account ${input.account} does not exist on the local chain.`)
  const id = await send(r, deps, giveTokensActions(input.account, quantity, await readAbi(deps, 'eosio.token')))
  return { account: input.account, quantity, transactionId: id }
}
