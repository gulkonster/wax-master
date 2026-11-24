import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'wm-ram-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => userData } }))
import {
  accountRamDefault,
  formatCost,
  formatUnits,
  parseAsset,
  parseRamMarket,
  ramCost,
  ramToBuy,
  RAM_DEFAULT_BUY
} from '../../src/shared/ram-market'
import { readRamPrice } from '../../src/main/ram-price'
import { RpcError } from '../../src/main/rpc'

describe('bytes to buy: missing + max(2048, 10 % of needed), rounded up to 1,024', () => {
  it('the owner case: needed 10,650, available 6,596', () => {
    // missing 4,054 + margin 2,048 = 6,102 -> 6,144
    expect(ramToBuy(10_650, 6_596)).toBe(6_144)
  })
  it('a large need takes 10 % as the margin', () => {
    // needed 100,000, available 20,000: missing 80,000 + 10,000 = 90,000 -> 90,112
    expect(ramToBuy(100_000, 20_000)).toBe(90_112)
  })
  it('the margin switches at 20,480 needed bytes', () => {
    expect(ramToBuy(20_480, 20_000)).toBe(3_072) // 480 + 2,048 = 2,528 -> 3,072
    expect(ramToBuy(20_490, 20_000)).toBe(3_072) // 490 + 2,049 = 2,539 -> 3,072
    expect(ramToBuy(30_000, 20_000)).toBe(13_312) // 10,000 + 3,000 = 13,000 -> 13,312
  })
  it('an exact multiple of 1,024 is not rounded further', () => {
    expect(ramToBuy(2_048, 2_048)).toBe(2_048) // nothing missing, margin 2,048
    expect(ramToBuy(4_096, 2_048)).toBe(4_096) // 2,048 + 2,048
  })
  it('a negative availability counts as none', () => {
    expect(ramToBuy(1_000, -5)).toBe(3_072) // 1,000 + 2,048 = 3,048 -> 3,072
  })
})

describe('Account page default', () => {
  it('8,192 bytes while at most 95 % is used', () => {
    expect(accountRamDefault(5_000, 10_000)).toBe(RAM_DEFAULT_BUY)
    expect(accountRamDefault(9_500, 10_000)).toBe(RAM_DEFAULT_BUY)
    expect(accountRamDefault(100, -1)).toBe(RAM_DEFAULT_BUY)
  })
  it('over 95 %: the bytes over 95 % plus the margin', () => {
    // usage 9,900 of 10,000: 95 % = 9,500, missing 400 + 2,048 = 2,448 -> 3,072
    expect(accountRamDefault(9_900, 10_000)).toBe(3_072)
    // usage 100,000 of 100,000: missing 5,000 + 10,000 = 15,000 -> 15,360
    expect(accountRamDefault(100_000, 100_000)).toBe(15_360)
  })
})

describe('assets', () => {
  it('parses and formats whole units', () => {
    expect(parseAsset('21894721.23456789 WAX')).toEqual({ units: 2189472123456789, precision: 8, symbol: 'WAX' })
    expect(parseAsset('39874593217 RAM')).toEqual({ units: 39874593217, precision: 0, symbol: 'RAM' })
    expect(parseAsset('-1.5000 EOS')).toEqual({ units: -15000, precision: 4, symbol: 'EOS' })
    expect(parseAsset('1.0 wax')).toBeNull()
    expect(parseAsset('abc')).toBeNull()
    expect(parseAsset(7)).toBeNull()
    expect(formatUnits(41_840_000, 8, 'WAX')).toBe('0.41840000 WAX')
    expect(formatUnits(5, 4, 'EOS')).toBe('0.0005 EOS')
    expect(formatUnits(12, 0, 'RAM')).toBe('12 RAM')
  })
  it('a cost is shown with four decimals, rounded up', () => {
    expect(formatCost(339_055_931, 8, 'WAX')).toBe('3.3906 WAX')
    expect(formatCost(41_840_000, 8, 'WAX')).toBe('0.4184 WAX')
    expect(formatCost(41_840_001, 8, 'WAX')).toBe('0.4185 WAX')
    expect(formatCost(1006, 4, 'EOS')).toBe('0.1006 EOS')
  })
})

const WAX_ROW = {
  supply: '10000000000.0000 RAMCORE',
  base: { balance: '39874593217 RAM', weight: '0.50000000000000000' },
  quote: { balance: '21894721.23456789 WAX', weight: '0.50000000000000000' }
}

describe('RAM cost: Bancor input on the rammarket connectors, then the 0.5 % fee', () => {
  it('reads the rammarket row', () => {
    expect(parseRamMarket(WAX_ROW)).toEqual({ ramReserve: 39874593217, quoteReserve: 2189472123456789, symbol: 'WAX', precision: 8 })
    expect(parseRamMarket({ base: { balance: '1.5 RAM' }, quote: { balance: '1.0000 WAX' } })).toBeNull()
    expect(parseRamMarket({ base: { balance: '100 RAM' } })).toBeNull()
    expect(parseRamMarket(null)).toBeNull()
  })
  it('small numbers that can be checked by hand', () => {
    const m = { ramReserve: 1_000_000, quoteReserve: 1_000_000, symbol: 'EOS', precision: 4 }
    // input = 1,000,000 * 1,000 / 999,000 = 1,001.001 -> 1,001; 1,001 / 0.995 = 1,006.03 -> 1,006
    expect(ramCost(m, 1_000)).toBe(1_006)
    expect(ramCost(m, 0)).toBe(0)
    expect(ramCost(m, 1_000_000)).toBeNull()
  })
  it('the WAX fixture', () => {
    const m = parseRamMarket(WAX_ROW)!
    // input = 2189472123456789 * 6144 / (39874593217 - 6144) = 337,360,652 (truncated)
    // with fee: 337,360,652 / 0.995 = 339,055,931.66 -> 339,055,931 (3.39055931 WAX)
    expect(ramCost(m, 6_144)).toBe(339_055_931)
  })
})

describe('main-process read of the RAM price', () => {
  it('answers the market and the cost', async () => {
    const r = await readRamPrice(6_144, async (body) => {
      expect(body).toMatchObject({ code: 'eosio', scope: 'eosio', table: 'rammarket' })
      return { rows: [WAX_ROW] }
    })
    expect(r).toMatchObject({ available: true, symbol: 'WAX', precision: 8, bytes: 6_144, cost: 339_055_931 })
  })
  it('a chain without the market: not available', async () => {
    expect((await readRamPrice(1, async () => ({ rows: [] }))).available).toBe(false)
    expect((await readRamPrice(1, async () => ({ rows: [{ base: 1 }] }))).available).toBe(false)
    const refused = await readRamPrice(1, async () => {
      throw new RpcError('Table not found', 500)
    })
    expect(refused.available).toBe(false)
  })
  it('an endpoint that cannot be reached is an error', async () => {
    await expect(
      readRamPrice(1, async () => {
        throw new RpcError('offline', 0)
      })
    ).rejects.toThrow('offline')
  })
  it('the node saying the table, contract or account is unknown: not available', async () => {
    const answers = [
      new RpcError('Internal Service Error', 500, { code: 500, error: { name: 'contract_table_query_exception', details: [{ message: 'Table rammarket is not specified in the ABI' }] } }),
      new RpcError('Internal Service Error', 500, { code: 500, error: { name: 'abi_not_found_exception', details: [{ message: 'No ABI found for eosio' }] } }),
      new RpcError('Internal Service Error', 500, { code: 500, error: { name: 'account_query_exception', details: [{ message: 'unknown key (eosio::chain::name): eosio' }] } }),
      new RpcError('Bad Request', 400, { code: 400, error: { name: 'exception', details: [{ message: 'Unknown table' }] } })
    ]
    for (const a of answers) {
      const r = await readRamPrice(1, async () => {
        throw a
      })
      expect(r).toEqual({ available: false, reason: 'This network has no system RAM market.' })
    }
  })
  it('429 and 5xx without such an answer are errors, never "not available"', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const e = new RpcError(`HTTP ${status}`, status, status === 500 ? { error: { what: 'database is busy' } } : null)
      await expect(readRamPrice(1, async () => Promise.reject(e))).rejects.toBe(e)
    }
    await expect(readRamPrice(1, async () => Promise.reject(new RpcError('HTTP 403', 403)))).rejects.toThrow('HTTP 403')
  })
  it('a failing first endpoint: readCall tries the next one and answers the market', async () => {
    const { readCall } = await import('../../src/main/networks')
    const net = { id: 'wax-testnet', name: 'X', kind: 'testnet', chainId: 'f1'.repeat(32), endpoints: ['https://a.example', 'https://b.example'], currentEndpoint: 0 }
    for (const status of [429, 502, 503, 504]) {
      const tried: string[] = []
      const errors: RpcError[] = [new RpcError(`HTTP ${status}`, status)]
      // Only the second endpoint answers.
      const r = await readCall(
        (ep) =>
          readRamPrice(1, async () => {
            tried.push(ep)
            const e = errors.shift()
            if (e) throw e
            return { rows: [WAX_ROW] }
          }),
        net as never
      )
      expect(tried).toEqual(['https://a.example', 'https://b.example'])
      expect(r).toMatchObject({ available: true, symbol: 'WAX' })
    }
    const all = await readCall((ep) => readRamPrice(1, async () => Promise.reject(new RpcError(`${ep} HTTP 503`, 503))), net as never).catch((e) => e)
    expect(all).toBeInstanceOf(RpcError)
    expect((all as Error).message).toBe('https://a.example HTTP 503 (2 endpoints tried)')
  })
  it('the shown text: "The RAM price could not be read"', async () => {
    const { ramPriceError } = await import('../../src/main/ram-price')
    expect(ramPriceError(new RpcError('Could not reach https://a.example: the connection was refused.', 0)).message).toBe(
      'The RAM price could not be read. Could not reach https://a.example: the connection was refused.'
    )
  })
})
