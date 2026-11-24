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

/** Checks that the endpoint serves compute_transaction (a missing handler answers 404). */
export async function probeSimulation(endpoint: string): Promise<SimulationSupport> {
  const cached = probes.get(endpoint)
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.support
  let support: SimulationSupport = 'unknown'
  try {
    await request(endpoint, '/v1/chain/compute_transaction', { body: {}, timeoutMs: 8000 })
    support = 'available'
  } catch (e) {
    if (e instanceof RpcError) support = e.status === 404 ? 'unsupported' : e.status === 0 ? 'unknown' : 'available'
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
