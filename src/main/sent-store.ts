// The node's answer of every transaction sent from the app and accepted by the
// node, kept so the transaction can be opened again later with every link and
// its console output (also on the local chain, which has no history service).
// One file per transaction: <data folder>/sent/<network id>/<transaction id>.json.
// An answer holds only what the node tells anyone who sends that transaction:
// no key and no signature secret. Write errors are logged and never fail a send.

import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from './jsonfile'
import { log } from './log'
import type { KeptTransaction } from '../shared/api'
import { LOCAL_CHAIN_NETWORK_ID } from '../shared/local-chain'
import { dataDir } from './paths'
import { listNetworks } from './networks'

/** At most this many answers per network; the oldest file goes. */
export const KEPT_PER_NETWORK = 200
/** An answer larger than this (as JSON) is not kept. */
export const KEPT_MAX_BYTES = 1024 * 1024

const TX_ID = /^[0-9a-f]{64}$/
const FILE = /^[0-9a-f]{64}\.json$/
/** Extra lock on a folder name; the id must also be a saved network. */
const NETWORK_ID = /^[A-Za-z0-9_-]{1,64}$/

export interface KeptMeta {
  /** Name of the network when it was sent. */
  network: string
  endpoint: string
  /** `contract::action` of the first action. */
  first: string
  /** Number of actions in the transaction. */
  count: number
}

export interface KeptFile extends KeptMeta {
  id: string
  /** ISO time of the send. */
  sentAt: string
  answer: unknown
}

export interface SentStore {
  keep(networkId: string, id: string, meta: KeptMeta, answer: unknown): boolean
  read(networkId: string, id: string): KeptFile | null
  list(networkId: string, limit: number): KeptTransaction[]
  clear(networkId: string): void
  clearAll(): void
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asKept(v: unknown): KeptFile | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!TX_ID.test(str(o.id)) || !str(o.sentAt)) return null
  return {
    id: str(o.id),
    sentAt: str(o.sentAt),
    network: str(o.network),
    endpoint: str(o.endpoint),
    first: str(o.first),
    count: typeof o.count === 'number' && Number.isInteger(o.count) && o.count >= 0 ? o.count : 0,
    answer: o.answer
  }
}

/**
 * The store in `root` (the `sent` folder). `knownNetwork` says whether an id is a
 * saved network; only then does it become a folder name.
 */
export function createSentStore(root: string, knownNetwork: (id: string) => boolean, now: () => Date = () => new Date()): SentStore {
  const folder = (networkId: string): string => {
    if (!NETWORK_ID.test(networkId) || !knownNetwork(networkId)) throw new Error('Unknown network')
    return join(root, networkId)
  }
  const txId = (id: string): string => {
    const x = id.toLowerCase()
    if (!TX_ID.test(x)) throw new Error('A transaction id is 64 hex characters')
    return x
  }
  /** The kept files of a folder, newest first. */
  const files = (dir: string): { name: string; time: number }[] => {
    if (!existsSync(dir)) return []
    const out: { name: string; time: number }[] = []
    for (const name of readdirSync(dir)) {
      if (!FILE.test(name)) continue
      try {
        out.push({ name, time: statSync(join(dir, name)).mtimeMs })
      } catch {
        // gone in between
      }
    }
    return out.sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : -1))
  }
  const readFile = (path: string): KeptFile | null => {
    try {
      return asKept(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return null
    }
  }

  return {
    keep(networkId, id, meta, answer) {
      try {
        const dir = folder(networkId)
        const tx = txId(id)
        let size: number
        try {
          size = Buffer.byteLength(JSON.stringify(answer) ?? '', 'utf8')
        } catch {
          log.warn(`Answer of transaction ${tx} not kept: not JSON`)
          return false
        }
        if (size > KEPT_MAX_BYTES) {
          log.info(`Answer of transaction ${tx} not kept: ${size} bytes is above the limit`)
          return false
        }
        const at = now()
        const file: KeptFile = { id: tx, sentAt: at.toISOString(), ...meta, answer }
        const path = join(dir, `${tx}.json`)
        writeJson(path, file)
        // The file time is the send time: the list and the limit go by it.
        utimesSync(path, at, at)
        for (const old of files(dir).slice(KEPT_PER_NETWORK)) rmSync(join(dir, old.name), { force: true })
        return true
      } catch (e) {
        log.warn(`Answer of a sent transaction not kept: ${e instanceof Error ? e.message : 'unknown error'}`)
        return false
      }
    },
    read(networkId, id) {
      const path = join(folder(networkId), `${txId(id)}.json`)
      if (!existsSync(path)) return null
      const f = readFile(path)
      return f && f.id === txId(id) ? f : null
    },
    list(networkId, limit) {
      const dir = folder(networkId)
      const out: KeptTransaction[] = []
      for (const x of files(dir)) {
        if (out.length >= limit) break
        const f = readFile(join(dir, x.name))
        if (f) out.push({ id: f.id, time: f.sentAt, first: f.first, count: f.count })
      }
      return out
    },
    clear(networkId) {
      // The network is no longer saved when this is called, so only the id pattern is checked.
      if (!NETWORK_ID.test(networkId)) throw new Error('Unknown network')
      rmSync(join(root, networkId), { recursive: true, force: true })
    },
    clearAll() {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

let store: SentStore | null = null

/** The app's store: the `sent` folder of the data folder, for the saved networks (and the local chain). */
export function sentStore(): SentStore {
  if (!store) store = createSentStore(join(dataDir(), 'sent'), (id) => id === LOCAL_CHAIN_NETWORK_ID || listNetworks().some((n) => n.id === id))
  return store
}
