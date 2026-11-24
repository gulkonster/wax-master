import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import fixture from '../fixtures/chain/network-info.json'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => 'C:\\nonexistent-waxm',
    getAppPath: () => 'C:\\nonexistent-waxm',
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import { addBlockSample, parseBlock, parseGlobal, parseInfo, parseRamPricePerKb, parseStat, wholeNumber, type BlockSample } from '../../src/shared/network-info'
import { readHead, readOverview, type ChainCalls, type Reader } from '../../src/main/network-info'
import { registerNetworkInfoIpc } from '../../src/main/ipc-network-info'
import { RpcError } from '../../src/main/rpc'

const T = fixture.testnet
const M = fixture.mainnet

describe('parsing get_info', () => {
  it('reads the testnet answer', () => {
    expect(parseInfo(T.get_info)).toEqual({
      chainId: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12',
      headBlock: 439195904,
      irreversible: 439195771,
      headTime: T.get_info.head_block_time,
      producer: 'nation.wax',
      serverVersion: 'v1.3.1wax02',
      cpuBlockLimit: 200000,
      netBlockLimit: 1048576
    })
  })
  it('reads the mainnet answer', () => {
    const b = parseInfo(M.get_info)!
    expect(b.chainId).toBe('1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4')
    expect(b.headBlock).toBe(468088050)
    expect(b.irreversible).toBe(468087963)
    expect(b.producer).toBe('waxhiveguild')
  })
  it('refuses answers that are not get_info', () => {
    expect(parseInfo(null)).toBeNull()
    expect(parseInfo([])).toBeNull()
    expect(parseInfo({ ...T.get_info, chain_id: 'xyz' })).toBeNull()
    expect(parseInfo({ ...T.get_info, head_block_num: -1 })).toBeNull()
    expect(parseInfo({ ...T.get_info, last_irreversible_block_num: 'many' })).toBeNull()
  })
  it('leaves out optional values that are missing or not plain text', () => {
    const b = parseInfo({ ...T.get_info, head_block_producer: 'NOT A NAME', server_version_string: 'a\u0007b', block_cpu_limit: 1.5, block_net_limit: undefined })!
    expect(b.producer).toBeNull()
    expect(b.serverVersion).toBe(T.get_info.server_version)
    expect(b.cpuBlockLimit).toBeNull()
    expect(b.netBlockLimit).toBeNull()
  })
  it('takes uint64 values as numbers or decimal strings', () => {
    expect(wholeNumber(5)).toBe(5)
    expect(wholeNumber('392238530560')).toBe(392238530560)
    expect(wholeNumber('99999999999999999999')).toBeNull()
    expect(wholeNumber('1e5')).toBeNull()
    expect(wholeNumber(-1)).toBeNull()
  })
})

describe('parsing global, rammarket and stat', () => {
  it('global: RAM total and reserved (uint64 as strings)', () => {
    expect(parseGlobal(T.global.rows[0])).toEqual({ total: 392238530560, reserved: 78520881533 })
    expect(parseGlobal(M.global.rows[0])).toEqual({ total: 314750913536, reserved: 187116258842 })
    expect(parseGlobal(undefined)).toBeNull()
    expect(parseGlobal({ max_ram_size: 0, total_ram_bytes_reserved: 0 })).toBeNull()
    expect(parseGlobal({ max_ram_size: 'x', total_ram_bytes_reserved: 1 })).toBeNull()
  })
  it('rammarket: price of 1 KB with the fee, at most four decimals, rounded up', () => {
    const t = parseRamPricePerKb(T.rammarket.rows[0])!
    expect(t.symbol).toBe('WAX')
    expect(t.precision).toBe(8)
    // 1594185484417463 * 1024 / (313717649027 - 1024), then / 0.995, truncated.
    expect(t.units).toBe(Math.trunc(Math.trunc((1594185484417463 * 1024) / (313717649027 - 1024)) / 0.995))
    expect(t.text).toBe('0.0523 WAX')
    expect(parseRamPricePerKb(M.rammarket.rows[0])!.text).toMatch(/^0\.\d{4} WAX$/)
    expect(parseRamPricePerKb({ base: { balance: '1 EOS' }, quote: { balance: '1.0000 WAX' } })).toBeNull()
    expect(parseRamPricePerKb(undefined)).toBeNull()
  })
  it('stat: the core token row', () => {
    expect(parseStat(T.stat.rows[0], 'WAX')).toEqual({
      symbol: 'WAX',
      precision: 8,
      supply: '5347364344.25962420 WAX',
      maxSupply: '46116860184.27387903 WAX',
      issuer: 'eosio'
    })
    expect(parseStat(M.stat.rows[0], 'WAX')!.supply).toBe('4728643368.15049457 WAX')
    expect(parseStat(T.stat.rows[0], 'EOS')).toBeNull()
    expect(parseStat({ supply: '1.00 WAX', max_supply: '1.000 WAX', issuer: 'eosio' }, 'WAX')).toBeNull()
    expect(parseStat({ supply: 7, max_supply: '1.000 WAX' }, 'WAX')).toBeNull()
  })
})

describe('parsing get_block', () => {
  it('reads number, id, time, producer and the number of transactions', () => {
    expect(parseBlock(T.get_block)).toEqual({
      num: 439195904,
      id: T.get_block.id,
      time: T.get_block.timestamp,
      producer: 'nation.wax',
      transactions: 0
    })
    expect(parseBlock(M.get_block)).toMatchObject({ num: 468088050, producer: 'waxhiveguild', transactions: 27 })
  })
  it('refuses answers that are not blocks', () => {
    expect(parseBlock({})).toBeNull()
    expect(parseBlock({ ...T.get_block, id: 'short' })).toBeNull()
    expect(parseBlock({ ...T.get_block, producer: 'Bad Name' })).toBeNull()
    expect(parseBlock({ ...T.get_block, timestamp: undefined })).toBeNull()
  })
  it('keeps 30 samples, newest first, without repeats', () => {
    const s = (num: number): BlockSample => ({ num, id: 'a'.repeat(64), time: 't', producer: 'p', transactions: 0 })
    let list: BlockSample[] = []
    for (let i = 1; i <= 40; i++) list = addBlockSample(list, s(i))
    list = addBlockSample(list, s(40))
    expect(list).toHaveLength(30)
    expect(list[0].num).toBe(40)
    expect(list[29].num).toBe(11)
  })
})

/** Fake chain: the fixture answers, or an error per table. */
type Answers = Record<'get_info' | 'get_block' | 'global' | 'rammarket' | 'stat', unknown>
function fakeCalls(f: Answers, fail: Partial<Record<'global' | 'rammarket' | 'stat' | 'block', unknown>> = {}): ChainCalls & { seen: Record<string, unknown>[] } {
  const seen: Record<string, unknown>[] = []
  return {
    seen,
    getInfo: async () => f.get_info,
    getTableRows: async (_ep, body) => {
      seen.push(body)
      const table = body.table as 'global' | 'rammarket' | 'stat'
      if (fail[table]) throw fail[table]
      return f[table] as { rows: unknown[] }
    },
    getBlock: async () => {
      if (fail.block) throw fail.block
      return f.get_block
    }
  }
}
const direct: Reader = (fn) => fn('https://node.example')
const noTable = new RpcError('Table eosio::global is not specified in the ABI', 500, { error: { what: 'Table query exception' } })

describe('reading the overview', () => {
  it('fills every value on WAX Testnet and reads the stat row of the market symbol', async () => {
    const calls = fakeCalls(T)
    const o = await readOverview('wax-testnet', 'WAX', direct, calls)
    expect(o.endpoint).toBe('https://node.example')
    expect(o.basics.headBlock).toBe(439195904)
    expect(o.ram).toEqual({ state: 'ok', value: { total: 392238530560, reserved: 78520881533 } })
    expect(o.ramPrice.state).toBe('ok')
    expect(o.token).toMatchObject({ state: 'ok', value: { symbol: 'WAX', supply: '5347364344.25962420 WAX' } })
    expect(calls.seen.find((b) => b.table === 'stat')).toMatchObject({ code: 'eosio.token', scope: 'WAX', limit: 1, json: true })
  })
  it('shows n/a on a chain without the system contract', async () => {
    const empty = { ...T, global: { rows: [] }, rammarket: { rows: [] }, stat: { rows: [] } }
    const o = await readOverview('local', 'EOS', direct, fakeCalls(empty, { global: noTable }))
    expect(o.ram.state).toBe('na')
    expect(o.ramPrice.state).toBe('na')
    expect(o.token.state).toBe('na')
    expect(o.basics.producer).toBe('nation.wax')
  })
  it('keeps a failed read apart from "n/a"', async () => {
    const o = await readOverview('wax-testnet', 'WAX', direct, fakeCalls(T, { stat: new RpcError('Could not reach https://node.example: the connection was refused.', 0) }))
    expect(o.token).toEqual({ state: 'error', reason: 'Could not reach https://node.example: the connection was refused.' })
    expect(o.ram.state).toBe('ok')
  })
  it('fails when get_info is not a get_info answer', async () => {
    const calls = { ...fakeCalls(T), getInfo: async () => ({ hello: 1 }) }
    await expect(readOverview('x', 'WAX', direct, calls)).rejects.toThrow('did not answer with chain information')
  })
})

describe('reading the head', () => {
  it('reads get_info and the head block from the endpoint that answered', async () => {
    let blockEp = ''
    const calls = { ...fakeCalls(M), getBlock: async (ep: string, n: number) => ((blockEp = `${ep}#${n}`), M.get_block) }
    const r = await readHead('wax-mainnet', direct, calls)
    expect(blockEp).toBe('https://node.example#468088050')
    expect(r.block).toMatchObject({ num: 468088050, transactions: 27 })
  })
  it('keeps the basics when the block cannot be read', async () => {
    const r = await readHead('wax-testnet', direct, fakeCalls(T, { block: new RpcError('HTTP 500', 500) }))
    expect(r.basics.headBlock).toBe(439195904)
    expect(r.block).toBeNull()
    expect(r.blockError).toBe('HTTP 500')
  })
})

function event(url: string, mainFrame = true): unknown {
  const frame = { url }
  return { senderFrame: frame, sender: { mainFrame: mainFrame ? frame : {}, send: () => undefined, isDestroyed: () => false } }
}
const good = event('app://bundle/index.html')
const CHANNELS = ['networkInfo:overview', 'networkInfo:head']

describe('network page channels', () => {
  let minimized = false
  beforeAll(() => {
    registerNetworkInfoIpc(() => ({ isMinimized: () => minimized }) as unknown as Electron.BrowserWindow)
  })
  const foreign: [string, unknown][] = [
    ['a foreign origin', event('https://example.com/index.html')],
    ['the confirmation page', event('app://bundle/confirm.html')],
    ['the terminal page', event('app://bundle/terminal.html')],
    ['a sub frame', event('app://bundle/index.html', false)]
  ]
  for (const channel of CHANNELS) {
    for (const [name, ev] of foreign) {
      it(`${channel} refuses ${name}`, async () => {
        await expect(h.handlers.get(channel)!(ev, 'wax-testnet')).rejects.toThrow('Refused')
      })
    }
    for (const bad of [undefined, 7, {}, ['wax-testnet'], 'x'.repeat(65), 'no-such-network']) {
      it(`${channel} refuses the network id ${JSON.stringify(bad)?.slice(0, 20)}`, async () => {
        await expect(h.handlers.get(channel)!(good, bad)).rejects.toThrow()
      })
    }
  }
  it('reads nothing while the window is minimized', async () => {
    minimized = true
    await expect(h.handlers.get('networkInfo:head')!(good, 'wax-testnet')).resolves.toBeNull()
    minimized = false
  })
  it('the editor preload exposes both calls', () => {
    const preload = readFileSync(join(__dirname, '../../src/preload/index.ts'), 'utf8')
    for (const c of CHANNELS) expect(preload).toContain(`call('${c}')`)
  })
})
