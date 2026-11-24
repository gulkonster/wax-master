// Simulate: sends an unsigned transaction to compute_transaction. The signer is
// never involved, so nothing can reach a block. Enabled per endpoint after a
// probe; results are always labelled with the endpoint that produced them.

import {
  bytesToHex,
  encodeAction,
  headerFromChainInfo,
  packTransaction,
  parseAbi,
  type AbiDef,
  type PermissionLevel
} from '../chain-core'
import type { InspectedTransaction } from '../shared/trace-types'
import { currentNetwork, endpointOf, getNetwork } from './networks'
import { chain, request, RpcError } from './rpc'
import { fromNodeAnswer, fromNodeError } from './trace'

export type SimulationSupport = 'available' | 'unsupported' | 'unknown'

const probes = new Map<string, { support: SimulationSupport; at: number }>()
const PROBE_TTL_MS = 30 * 60 * 1000
const UNKNOWN_TTL_MS = 60 * 1000

/** Is this a body the node itself writes (a trace, or an error object with the node's own fields)? */
function isNodeBody(body: unknown, ok: boolean): boolean {
  if (typeof body !== 'object' || body === null) return false
  const b = body as { processed?: { id?: unknown } | null; transaction_id?: unknown; error?: { code?: unknown; what?: unknown } | null }
  if (ok) return typeof b.processed === 'object' && b.processed !== null && (typeof b.processed.id === 'string' || typeof b.transaction_id === 'string')
  return typeof b.error === 'object' && b.error !== null && typeof b.error.code === 'number' && typeof b.error.what === 'string'
}

/**
 * Checks that the endpoint serves compute_transaction. Only a node's own answer
 * counts as available: a trace, or a JSON error carrying the node's error code.
 * A missing handler answers 404; any other answer (a proxy page, a 403, a 502,
 * a timeout) leaves it unknown.
 */
export async function probeSimulation(endpoint: string): Promise<SimulationSupport> {
  const cached = probes.get(endpoint)
  if (cached && Date.now() - cached.at < (cached.support === 'unknown' ? UNKNOWN_TTL_MS : PROBE_TTL_MS)) return cached.support
  let support: SimulationSupport = 'unknown'
  try {
    const answer = await request<unknown>(endpoint, '/v1/chain/compute_transaction', { body: {}, timeoutMs: 8000 })
    support = isNodeBody(answer, true) ? 'available' : 'unknown'
  } catch (e) {
    if (e instanceof RpcError) support = e.status === 404 ? 'unsupported' : isNodeBody(e.details, false) ? 'available' : 'unknown'
  }
  probes.set(endpoint, { support, at: Date.now() })
  return support
}

export interface SimulateAction {
  account: string
  name: string
  authorization: PermissionLevel[]
  data: unknown
}

export async function simulate(actions: SimulateAction[], networkId?: string): Promise<InspectedTransaction> {
  const network = networkId ? getNetwork(networkId) : currentNetwork()
  const endpoint = endpointOf(network)
  const support = await probeSimulation(endpoint)
  if (support === 'unsupported') throw new Error(`Simulation is not offered by ${endpoint}.`)
  const info = await chain.getInfo(endpoint)
  if (info.chain_id !== network.chainId) throw new Error(`The endpoint ${endpoint} reports another chain id than ${network.name}.`)
  const abis = new Map<string, AbiDef>()
  const packedActions = []
  for (const a of actions) {
    let abi = abis.get(a.account)
    if (!abi) {
      const r = await chain.getAbi(endpoint, a.account)
      if (!r.abi) throw new Error(`The account ${a.account} has no contract (no ABI)`)
      abi = parseAbi(r.abi)
      abis.set(a.account, abi)
    }
    packedActions.push({ account: a.account, name: a.name, authorization: a.authorization, data: bytesToHex(encodeAction(abi, a.name, a.data)) })
  }
  const packed = packTransaction({ ...headerFromChainInfo(info, 120), actions: packedActions })
  const ctx = { source: 'simulation' as const, network: network.name, endpoint }
  try {
    const answer = await request(endpoint, '/v1/chain/compute_transaction', {
      body: { transaction: { signatures: [], compression: 0, packed_context_free_data: '', packed_trx: bytesToHex(packed) } },
      timeoutMs: 20_000
    })
    probes.set(endpoint, { support: 'available', at: Date.now() })
    return fromNodeAnswer(answer, ctx)
  } catch (e) {
    if (e instanceof RpcError && e.details) return fromNodeError(e.details, ctx)
    throw e
  }
}
