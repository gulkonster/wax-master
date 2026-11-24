/* Test-only helpers around eosjs, used to cross-check the chain core. */
import * as ser from 'eosjs/dist/eosjs-serialize'
import { Api } from 'eosjs'
import type { AbiDef } from '../../src/chain-core'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function ejsContract(abi: AbiDef): ser.Contract {
  const types = ser.getTypesFromAbi(ser.createInitialTypes(), abi as never)
  const actions = new Map<string, ser.Type>()
  for (const a of abi.actions) actions.set(a.name, ser.getType(types, a.type))
  return { types, actions }
}

/** Serializes action data with eosjs; returns hex. */
export function ejsEncode(abi: AbiDef, account: string, name: string, data: unknown): string {
  return ser.serializeActionData(ejsContract(abi), account, name, data, textEncoder, textDecoder).toLowerCase()
}

export function ejsDecode(abi: AbiDef, account: string, name: string, hex: string): unknown {
  return ser.deserializeActionData(ejsContract(abi), account, name, hex, textEncoder, textDecoder)
}

export function ejsApi(): Api {
  return new Api({ rpc: {} as never, signatureProvider: {} as never, textDecoder, textEncoder })
}

/** eosjs prints time_point_sec with milliseconds; the chain core follows nodeos and omits them. */
export function normTimes(v: unknown): unknown {
  if (typeof v === 'string') {
    if (/^([0-9A-F]{2}){2,}$/.test(v)) return v.toLowerCase()
    return v.replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.000$/, '$1')
  }
  if (Array.isArray(v)) return v.map(normTimes)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normTimes(x)]))
  return v
}
