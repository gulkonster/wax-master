import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'C:\\nonexistent-waxm', getAppPath: () => 'C:\\nonexistent-waxm', getVersion: () => '0.0.0', on: () => undefined },
  ipcMain: { handle: () => undefined },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import { KEPT_MAX_BYTES, KEPT_PER_NETWORK, createSentStore, type KeptFile } from '../../src/main/sent-store'
import { NOT_KNOWN_MESSAGE, noSourceMessage, openTransaction, type OpenSources } from '../../src/main/ipc-tx'
import { BLOCK_RAW_TITLE, fromKept } from '../../src/main/trace'
import type { NetworkInfo } from '../../src/shared/chain-types'
import type { TraceNode } from '../../src/shared/trace-types'

const fixtures = join(__dirname, '../fixtures/history')
const load = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(fixtures, name), 'utf8'))

const id = (i: number): string => i.toString(16).padStart(64, '0')
const meta = { network: 'WAX Testnet', endpoint: 'https://node.example', first: 'eosio.token::transfer', count: 1 }
const answer = (tx: string): unknown => ({
  transaction_id: tx,
  processed: {
    id: tx,
    block_num: 10,
    block_time: '2026-11-25T10:00:00.000',
    receipt: { status: 'executed', cpu_usage_us: 200, net_usage_words: 16 },
    action_traces: [
      {
        action_ordinal: 1,
        creator_action_ordinal: 0,
        receiver: 'eosio.token',
        receipt: { receiver: 'eosio.token', global_sequence: 5 },
        act: { account: 'eosio.token', name: 'transfer', authorization: [{ actor: 'alice', permission: 'active' }], data: { memo: 'x' } },
        console: 'hello'
      }
    ]
  }
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'waxm-sent-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function store(start = Date.UTC(2026, 10, 25)): ReturnType<typeof createSentStore> {
  let t = start
  return createSentStore(join(dir, 'sent'), (n) => n === 'wax-testnet' || n === 'local-chain', () => new Date((t += 1000)))
}

describe('kept answers', () => {
  it('keeps one file per transaction under the network, named by the 64 hex characters only', () => {
    const s = store()
    expect(s.keep('wax-testnet', id(1).toUpperCase(), meta, answer(id(1)))).toBe(true)
    expect(readdirSync(join(dir, 'sent', 'wax-testnet'))).toEqual([`${id(1)}.json`])
    const f = s.read('wax-testnet', id(1)) as KeptFile
    expect(f.id).toBe(id(1))
    expect(f.first).toBe('eosio.token::transfer')
    expect(f.answer).toEqual(answer(id(1)))
    expect(s.read('wax-testnet', id(2))).toBeNull()
  })

  it('refuses a bad id and a network that is not saved; keep never throws', () => {
    const s = store()
    expect(s.keep('wax-testnet', '../x', meta, {})).toBe(false)
    expect(s.keep('wax-testnet', 'g'.repeat(64), meta, {})).toBe(false)
    expect(s.keep('other', id(1), meta, {})).toBe(false)
    expect(s.keep('..', id(1), meta, {})).toBe(false)
    expect(() => s.read('wax-testnet', '../../vault')).toThrow()
    expect(() => s.read('..\\x', id(1))).toThrow()
    expect(() => s.list('nope', 20)).toThrow()
    expect(existsSync(join(dir, 'sent'))).toBe(false)
  })

  it('does not keep an answer above 1 MB', () => {
    const s = store()
    expect(s.keep('wax-testnet', id(1), meta, { big: 'x'.repeat(KEPT_MAX_BYTES) })).toBe(false)
    expect(s.read('wax-testnet', id(1))).toBeNull()
  })

  it('keeps at most 200 per network; the oldest goes; the list is newest first', () => {
    const s = store()
    for (let i = 1; i <= KEPT_PER_NETWORK + 3; i++) s.keep('wax-testnet', id(i), { ...meta, count: i }, answer(id(i)))
    s.keep('local-chain', id(999), meta, answer(id(999)))
    expect(readdirSync(join(dir, 'sent', 'wax-testnet'))).toHaveLength(KEPT_PER_NETWORK)
    expect(s.read('wax-testnet', id(1))).toBeNull()
    expect(s.read('wax-testnet', id(3))).toBeNull()
    expect(s.read('wax-testnet', id(4))).not.toBeNull()
    const list = s.list('wax-testnet', 20)
    expect(list).toHaveLength(20)
    expect(list[0]).toEqual({ id: id(KEPT_PER_NETWORK + 3), time: expect.any(String), first: 'eosio.token::transfer', count: KEPT_PER_NETWORK + 3 })
    expect(list[19].id).toBe(id(KEPT_PER_NETWORK + 3 - 19))
    expect(s.list('local-chain', 20).map((x) => x.id)).toEqual([id(999)])
  })

  it('skips a broken file and clears one network or all', () => {
    const s = store()
    s.keep('wax-testnet', id(1), meta, answer(id(1)))
    s.keep('local-chain', id(2), meta, answer(id(2)))
    writeFileSync(join(dir, 'sent', 'wax-testnet', `${id(3)}.json`), '{ broken')
    expect(s.list('wax-testnet', 20).map((x) => x.id)).toEqual([id(1)])
    expect(s.read('wax-testnet', id(3))).toBeNull()
    s.clear('local-chain')
    expect(s.list('local-chain', 20)).toEqual([])
    expect(s.list('wax-testnet', 20)).toHaveLength(1)
    s.clearAll()
    expect(existsSync(join(dir, 'sent'))).toBe(false)
  })

  it('clear deletes the folder of an id that is not a saved network and refuses an id outside the pattern', () => {
    const s = store()
    mkdirSync(join(dir, 'sent', 'removed-net'), { recursive: true })
    writeFileSync(join(dir, 'sent', 'removed-net', `${id(1)}.json`), '{}')
    s.clear('removed-net')
    expect(existsSync(join(dir, 'sent', 'removed-net'))).toBe(false)
    expect(() => s.clear('..')).toThrow(/Unknown network/)
    expect(() => s.clear('a/b')).toThrow(/Unknown network/)
  })

  it('a kept answer is shown with source kept, its send time, the console and every link', () => {
    const t = fromKept({ sentAt: '2026-11-25T10:00:00.000Z', ...meta, answer: answer(id(1)) })
    expect(t.source).toBe('kept')
    expect(t.keptAt).toBe('2026-11-25T10:00:00.000Z')
    expect(t.actions[0].console).toBe('hello')
    expect(t.raw.map((r) => r.title)).toEqual(['Node answer'])
  })
})

// ---- tx:open ----

const v2 = load('mainnet-706fdfc9-v2.json')
const v1 = load('mainnet-706fdfc9-v1.json')
const MAINNET_ID = '706fdfc93c488b3b795d051d3ef211bf9ba165a93551ec2de9d350c236e40906'
const block = {
  transactions: [
    { status: 'executed', cpu_usage_us: 1, net_usage_words: 1, trx: { id: 'f'.repeat(64) } },
    {
      status: 'executed',
      cpu_usage_us: 777,
      net_usage_words: 20,
      trx: { id: MAINNET_ID, signatures: ['SIG_K1_x'], packed_trx: '00', transaction: { context_free_actions: [], actions: [{ account: 'game.brpg', name: 'craft' }] } }
    }
  ]
}

function net(history?: string): NetworkInfo {
  return {
    id: 'wax-mainnet',
    name: 'WAX Mainnet',
    kind: 'mainnet',
    chainId: 'a'.repeat(64),
    symbol: 'WAX',
    precision: 8,
    endpoints: ['https://node.example'],
    currentEndpoint: 0,
    ...(history ? { history } : {})
  } as NetworkInfo
}

function sources(over: Partial<OpenSources> = {}): OpenSources & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    network: net('https://hist.example'),
    kept: () => null,
    historyV2: async (h, tx) => {
      calls.push(`v2 ${h} ${tx}`)
      return v2
    },
    historyV1: async (h, tx, hint) => {
      calls.push(`v1 ${h} ${tx} ${hint}`)
      return v1
    },
    block: async (ep, num) => {
      calls.push(`block ${ep} ${num}`)
      return block
    },
    ...over
  }
}

const keptFile = (tx: string): KeptFile => ({ id: tx, sentAt: '2026-11-25T10:00:00.000Z', ...meta, answer: answer(tx) })
const flat = (nodes: TraceNode[]): TraceNode[] => nodes.flatMap((x) => [x, ...flat(x.children)])

describe('tx:open', () => {
  it('reads the kept answer first and asks nothing else', async () => {
    const src = sources({ kept: (_n, tx) => keptFile(tx) })
    const t = await openTransaction(MAINNET_ID, undefined, src)
    expect(t.source).toBe('kept')
    expect(t.hasKept).toBe(true)
    expect(t.hasHistory).toBe(true)
    expect(src.calls).toEqual([])
  })

  it('reads the history service when forced, also with a kept answer', async () => {
    const src = sources({ kept: (_n, tx) => keptFile(tx) })
    const t = await openTransaction(MAINNET_ID, 'history', src)
    expect(t.source).toBe('history')
    expect(t.hasKept).toBe(true)
    expect(src.calls).toEqual([`v2 https://hist.example ${MAINNET_ID}`, `v1 https://hist.example ${MAINNET_ID} 468279749`, 'block https://node.example 468279749'])
  })

  it('without a kept answer: history, then the two reads; the v1 RAM changes are joined by global sequence', async () => {
    const t = await openTransaction(MAINNET_ID.toUpperCase(), undefined, sources())
    expect(t.hasKept).toBe(false)
    const all = flat(t.actions)
    expect(all).toHaveLength(18)
    // Each trace has the deltas of the v1 trace with the same global sequence.
    const bySeq = new Map((v1.traces as { receipt: { global_sequence: unknown }; account_ram_deltas: { account: string; delta: unknown }[] }[]).map((x) => [String(x.receipt.global_sequence), x.account_ram_deltas]))
    for (const x of all) {
      const want = bySeq.get(x.sequence!)!
      expect(x.ramDeltas).toEqual(want.map((d) => ({ account: d.account, delta: Number(d.delta) })))
    }
    const mints = all.filter((x) => x.name === 'mintasset')
    expect(mints).toHaveLength(2)
    expect(mints.every((m) => (m.ramDeltas ?? []).length > 0)).toBe(true)
    expect(t.notes).not.toContain('The history service joined identical actions; their RAM changes may be listed once.')
    expect(t.raw.map((r) => r.title)).toEqual(['History service answer', BLOCK_RAW_TITLE])
    expect(t.raw[1].text).toContain('SIG_K1_x')
  })

  it('a failed v1 or block read leaves its part as not returned', async () => {
    const fail = async (): Promise<never> => {
      throw new Error('HTTP 400')
    }
    const t = await openTransaction(MAINNET_ID, undefined, sources({ historyV1: fail, block: fail }))
    expect(t.source).toBe('history')
    expect(t.notes).toContain('The history service joined identical actions; their RAM changes may be listed once.')
    expect(t.raw[1]).toEqual({ title: BLOCK_RAW_TITLE, text: '(not returned by this endpoint)' })
  })

  it('fills CPU, NET and status from the block only when the history answer had none', async () => {
    const bare = { ...v2, actions: (v2.actions as Record<string, unknown>[]).map(({ cpu_usage_us: _c, net_usage_words: _n, ...rest }) => rest) }
    const t = await openTransaction(MAINNET_ID, undefined, sources({ historyV2: async () => bare }))
    expect(t.cpuUs).toBe(777)
    expect(t.netBytes).toBe(160)
    const full = await openTransaction(MAINNET_ID, undefined, sources())
    expect(full.cpuUs).not.toBe(777)
  })

  it('says the two messages of the kept answer', async () => {
    await expect(openTransaction(MAINNET_ID, undefined, sources({ network: net() }))).rejects.toThrow(noSourceMessage('WAX Mainnet'))
    expect(noSourceMessage('Local chain')).toBe(
      'Local chain has no history service, and this transaction was not sent from WAX Master on this computer. Add a history service in Network > Manage Networks.'
    )
    await expect(openTransaction(MAINNET_ID, undefined, sources({ historyV2: async () => ({ executed: false }) }))).rejects.toThrow(NOT_KNOWN_MESSAGE)
  })

  it('a forced kept read without a kept answer reads nothing else', async () => {
    const src = sources()
    await expect(openTransaction(MAINNET_ID, 'kept', src)).rejects.toThrow(/no longer has the node's answer of this transaction/)
    expect(src.calls).toEqual([])
  })

  it('on a network without history a kept answer still opens', async () => {
    const t = await openTransaction(MAINNET_ID, undefined, sources({ network: net(), kept: (_n, tx) => keptFile(tx) }))
    expect(t.source).toBe('kept')
    expect(t.hasHistory).toBe(false)
  })
})
