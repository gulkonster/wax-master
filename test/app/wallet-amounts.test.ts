// Wallet amounts and balances: no silent decimal comma, exact units at every
// size, precision from the supply text, zero as a balance, history amounts
// exact or read from the chain, the look-alike marks, the refund time, the
// form state after a send and the reads that follow it, the token file.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userData: '',
  network: { id: 'wax-testnet', name: 'WAX Testnet', chainId: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12', symbol: 'WAX', precision: 8 } as Record<string, unknown>,
  account: {} as Record<string, unknown>,
  balance: [] as unknown
}))

vi.mock('electron', () => ({ app: { getPath: () => h.userData, isPackaged: false, getAppPath: () => h.userData } }))
vi.mock('../../src/main/networks', () => ({
  WAX_TESTNET_CHAIN: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12',
  currentNetwork: () => h.network,
  readCall: (fn: (ep: string) => unknown) => fn('https://node.example')
}))
vi.mock('../../src/main/rpc', () => ({
  chain: {
    getAccount: async () => h.account,
    getCurrencyBalance: async () => h.balance,
    getCodeHash: async () => ({ code_hash: '0'.repeat(64) })
  },
  history: {}
}))

h.userData = mkdtempSync(join(tmpdir(), 'wm-wallet-amounts-'))

import { accountView, refundSecondsLeft, REFUND_DELAY_SEC, WAX_CHAIN_IDS } from '../../src/main/account-view'
import {
  AddedTokens,
  balanceFromAnswer,
  historyAmount,
  MAX_HISTORY_READS,
  parseHistoryTokens,
  precisionFromStats,
  tokenBalance,
  walletTokens
} from '../../src/main/wallet-tokens'
import type { NetworkInfo } from '../../src/shared/chain-types'
import { amountProblem, amountUnits, ASSET_MAX_UNITS, assetUnits, COMMA_TEXT, formatUnits, quantityText, readAsset } from '../../src/shared/wallet'
import { AFTER_SEND_READS_MS, amountNote, CLEARED_FIELD, refundTimeText, scheduleReadsAfterSend } from '../../src/renderer/src/pages/account/wallet-form'

const WAX = { id: 'wax-testnet', name: 'WAX Testnet', symbol: 'WAX', precision: 8 } as NetworkInfo

describe('a decimal comma is refused, never removed', () => {
  it('1,5 and 1,000 and 1.000,5 are not amounts', () => {
    for (const t of ['1,5', '1,000', '1.000,5']) {
      expect(amountUnits(t, 8)).toBeNull()
      expect(quantityText(t, 8, 'WAX')).toBeNull()
      expect(amountProblem(t, 8)).toBe(COMMA_TEXT)
      expect(amountNote({ text: t, touched: true }, 8, true)).toBe(COMMA_TEXT)
    }
    expect(COMMA_TEXT).toBe('Use a point for the decimals, without thousands separators.')
    expect(amountProblem('1.5', 8)).toBe('')
  })
})

describe('units are exact at every size', () => {
  it('large amounts and 18-decimal tokens', () => {
    expect(amountUnits('90071993', 8)).toBe(9_007_199_300_000_000n)
    expect(quantityText('90071993.47409921', 8, 'WAX')).toBe('90071993.47409921 WAX')
    expect(amountUnits('0.01', 18)).toBe(10n ** 16n)
    expect(quantityText('0.01', 18, 'ETH')).toBe('0.010000000000000000 ETH')
  })
  it('up to the chain limit of 2^62 - 1 units, not above', () => {
    expect(ASSET_MAX_UNITS).toBe(4_611_686_018_427_387_903n)
    expect(amountUnits('46116860184.27387903', 8)).toBe(ASSET_MAX_UNITS)
    expect(amountUnits('46116860184.27387904', 8)).toBeNull()
    expect(readAsset('46116860184.27387903 WAX')?.units).toBe(ASSET_MAX_UNITS)
    expect(readAsset('46116860184.27387904 WAX')).toBeNull()
  })
  it('formats and compares in bigint', () => {
    expect(formatUnits(5n, 4, 'EOS')).toBe('0.0005 EOS')
    expect(formatUnits(12n, 0, 'RAM')).toBe('12 RAM')
    expect(assetUnits('3770000000.00000000 ABC', 8, 'ABC')).toBe(377_000_000_000_000_000n)
    expect(assetUnits('1.5 TLM', 4, 'TLM')! > assetUnits('1.4999 TLM', 4, 'TLM')!).toBe(true)
  })
})

describe('Add token: precision from the supply text', () => {
  it('counts the decimals of any size of supply', () => {
    expect(precisionFromStats({ ABC: { supply: '3770000000.00000000 ABC' } }, 'ABC')).toBe(8)
    expect(precisionFromStats({ ABC: { supply: '99999999999999999999.0000 ABC' } }, 'ABC')).toBe(4)
    expect(precisionFromStats({ NFT: { supply: '12 NFT' } }, 'NFT')).toBe(0)
    expect(precisionFromStats({ ABC: { supply: 'x', max_supply: '1.00 ABC' } }, 'ABC')).toBe(2)
    expect(precisionFromStats({ ABC: { supply: '1.00 XYZ' } }, 'ABC')).toBeNull()
  })
})

describe('balances: zero is a balance, an unreadable answer is not', () => {
  it('an empty answer is zero; a row of the symbol that cannot be read is not', () => {
    expect(balanceFromAnswer([], 'WAX', 8).balance).toBe('0.00000000 WAX')
    expect(balanceFromAnswer(['1.5000 TLM'], 'WAX', 8).balance).toBe('0.00000000 WAX')
    expect(balanceFromAnswer(['abc WAX'], 'WAX', 8).balance).toBe('')
    expect(balanceFromAnswer(['99999999999999999999.00000000 WAX'], 'WAX', 8).balance).toBe('')
    expect(balanceFromAnswer('text', 'WAX', 8).balance).toBe('')
    expect(balanceFromAnswer(['90071993.47409921 WAX'], 'WAX', 8)).toEqual({ balance: '90071993.47409921 WAX', precision: 8 })
  })
  it('the core token: empty answer zero, failed read "could not be read"', async () => {
    const zero = await walletTokens(WAX, { coreBalance: async () => [], balance: async () => [], added: [] })
    expect(zero.rows[0].balance).toBe('0.00000000 WAX')
    const failed = await walletTokens(WAX, {
      coreBalance: async () => {
        throw new Error('HTTP 500')
      },
      balance: async () => [],
      added: []
    })
    expect(failed.rows[0].balance).toBe('')
  })
  it('an added token: large balances read; an unreadable answer is not zero', async () => {
    const r = await walletTokens(WAX, {
      coreBalance: async () => ['1.00000000 WAX'],
      balance: async (_c, symbol) => (symbol === 'BIG' ? ['3770000000.00000000 BIG'] : symbol === 'BAD' ? ['x.y BAD'] : []),
      added: [
        { contract: 'bigtoken', symbol: 'BIG', precision: 8 },
        { contract: 'badtoken', symbol: 'BAD', precision: 4 },
        { contract: 'emptytoken', symbol: 'EMP', precision: 2 }
      ]
    })
    expect(r.rows.slice(1).map((x) => x.balance)).toEqual(['3770000000.00000000 BIG', '', '0.00 EMP'])
  })
})

describe('wallet:balance for the Transfer form', () => {
  it('the row of get_currency_balance, with its precision', async () => {
    expect(await tokenBalance({ balance: async () => ['12.3400 TLM'], stats: async () => ({}) }, 'alien.worlds', 'TLM')).toEqual({ balance: '12.3400 TLM', precision: 4 })
  })
  it('no row: zero at the precision of get_currency_stats', async () => {
    expect(await tokenBalance({ balance: async () => [], stats: async () => ({ TLM: { supply: '1000.0000 TLM' } }) }, 'alien.worlds', 'TLM')).toEqual({
      balance: '0.0000 TLM',
      precision: 4
    })
  })
  it('refuses a contract without the token and an unreadable row', async () => {
    await expect(tokenBalance({ balance: async () => [], stats: async () => ({}) }, 'alien.worlds', 'TLM')).rejects.toThrow('has no token TLM')
    await expect(tokenBalance({ balance: async () => ['x TLM'], stats: async () => ({}) }, 'alien.worlds', 'TLM')).rejects.toThrow('could not be read')
    await expect(tokenBalance({ balance: async () => ({}), stats: async () => ({}) }, 'alien.worlds', 'TLM')).rejects.toThrow()
  })
})

describe('history amounts: exact or read from the chain', () => {
  it('a text is taken by its digits', () => {
    expect(historyAmount('90071993.47409921', 8, 'WAX')).toBe('90071993.47409921 WAX')
    expect(historyAmount('12.5', 4, 'TLM')).toBe('12.5000 TLM')
    expect(historyAmount('12.50000', 4, 'TLM')).toBe('12.5000 TLM')
    expect(historyAmount('1e5', 4, 'TLM')).toBeNull()
  })
  it('a number only while its units are exact', () => {
    expect(historyAmount(10262.9462, 4, 'CRW')).toBe('10262.9462 CRW')
    expect(historyAmount(90071993.47409921, 8, 'WAX')).toBe('read')
    expect(historyAmount(1e300, 4, 'BIG')).toBe('read')
    expect(historyAmount(1e-7, 8, 'WAX')).toBe('read')
    expect(historyAmount(-1, 4, 'X')).toBeNull()
    expect(historyAmount(Number.NaN, 4, 'X')).toBeNull()
  })
  it('no row is dropped because its amount is large', () => {
    const rows = parseHistoryTokens({ tokens: [{ symbol: 'BIG', precision: 8, amount: 9e15, contract: 'bigtoken' }] })
    expect(rows).toEqual([{ contract: 'bigtoken', symbol: 'BIG', precision: 8, balance: '', source: 'history' }])
  })
  it('those rows are read from the chain, at most 20 per list', async () => {
    const tokens = Array.from({ length: 25 }, (_, i) => ({ symbol: `B${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]}`, precision: 4, amount: 1e300, contract: 'bigtoken' }))
    const asked: string[] = []
    const r = await walletTokens(WAX, {
      coreBalance: async () => [],
      historyTokens: async () => ({ tokens }),
      balance: async (_c, symbol) => {
        asked.push(symbol)
        return [`123456789012345.6789 ${symbol}`]
      },
      added: []
    })
    expect(asked).toHaveLength(MAX_HISTORY_READS)
    expect(r.rows.slice(1, 21).every((x) => x.balance.startsWith('123456789012345.6789 '))).toBe(true)
    expect(r.rows.slice(21).every((x) => x.balance === '')).toBe(true)
  })
})

describe('look-alike tokens', () => {
  it('marks the core token and the network symbol on other contracts, which come last', async () => {
    // As faucet.wax on WAX Testnet: WAX from six contracts.
    const tokens = [
      { symbol: 'WAX', precision: 8, amount: '5.00000000', contract: 'eosio.token' },
      { symbol: 'WAX', precision: 8, amount: '1000.00000000', contract: 'fakewaxtoken' },
      { symbol: 'TLM', precision: 4, amount: '1.0000', contract: 'alien.worlds' },
      { symbol: 'WAX', precision: 4, amount: '1.0000', contract: 'waxtokenaaaa' },
      { symbol: 'WAX', precision: 8, amount: '2.00000000', contract: 'wax.token' },
      { symbol: 'WAX', precision: 8, amount: '3.00000000', contract: 'waxio.token' },
      { symbol: 'WAX', precision: 8, amount: '4.00000000', contract: 'tokenwax1111' }
    ]
    const r = await walletTokens(WAX, {
      coreBalance: async () => ['5.00000000 WAX'],
      historyTokens: async () => ({ tokens }),
      balance: async () => [],
      added: [{ contract: 'addedwax1111', symbol: 'WAX', precision: 8 }]
    })
    expect(r.rows.map((x) => [x.contract, x.mark?.kind ?? ''])).toEqual([
      ['eosio.token', 'core'],
      ['alien.worlds', ''],
      ['fakewaxtoken', 'lookalike'],
      ['waxtokenaaaa', 'lookalike'],
      ['wax.token', 'lookalike'],
      ['waxio.token', 'lookalike'],
      ['tokenwax1111', 'lookalike'],
      ['addedwax1111', 'lookalike']
    ])
    expect(r.rows[0].mark?.text).toBe('core token')
    expect(r.rows[2].mark?.text).toBe('not the WAX of WAX Testnet')
  })
})

describe('refund time from chain time', () => {
  it('seconds from the head time to the due time', () => {
    expect(refundSecondsLeft('2026-11-24T16:30:59', '2026-11-24T16:30:59.500')).toBe(REFUND_DELAY_SEC)
    expect(refundSecondsLeft('2026-11-24T16:30:59', '2026-11-27T16:30:58.000')).toBe(1)
    expect(refundSecondsLeft('2026-11-24T16:30:59', '2026-11-28T00:00:00.000')).toBeLessThan(0)
    expect(refundSecondsLeft('2026-11-24T16:30:59', '')).toBeNull()
  })
  it('exact on the two WAX chains, "about" elsewhere', () => {
    expect(WAX_CHAIN_IDS).toHaveLength(2)
    expect(refundTimeText(true, false, 'T', 'R')).toBe('Can be claimed from T.')
    expect(refundTimeText(true, true, 'T', 'R')).toBe('Can be claimed now.')
    expect(refundTimeText(false, false, 'T', 'R')).toBe('About 3 days after the unstake (R), if this chain uses the standard waiting time.')
  })
})

describe('accountView: sums in whole units, refund against chain time', () => {
  beforeEach(() => {
    h.balance = []
    h.network = { ...h.network, chainId: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12' }
  })
  it('adds large amounts exactly', async () => {
    h.account = {
      core_liquid_balance: '90071993.47409921 WAX',
      self_delegated_bandwidth: { cpu_weight: '0.00000001 WAX', net_weight: '1.00000000 WAX' },
      total_resources: { cpu_weight: '2.00000001 WAX', net_weight: '1.00000000 WAX' },
      refund_request: { request_time: '2026-11-24T16:30:59', cpu_amount: '1.00000000 WAX', net_amount: '0.00000000 WAX' },
      head_block_time: '2026-11-25T16:30:59.000',
      permissions: []
    }
    const v = await accountView('bfhlbfzsowj3')
    expect(v.total).toBe('90071995.47409922 WAX')
    expect(v.staked).toBe('1.00000001 WAX')
    expect(v.refund).toBe('1.00000000 WAX')
    expect(v.stakedByOthers).toBe('2.00000000 WAX')
    expect(v.refundSecondsLeft).toBe(2 * 24 * 3600)
    expect(v.refundExact).toBe(true)
  })
  it('an empty balance answer is zero; another chain is not exact', async () => {
    h.network = { ...h.network, chainId: 'c'.repeat(64) }
    h.account = { permissions: [], head_block_time: '2026-11-25T00:00:00.000' }
    const v = await accountView('someone')
    expect(v.liquid).toBe('0.00000000 WAX')
    expect(v.refundSecondsLeft).toBe(0)
    expect(v.refundExact).toBe(false)
  })
})

describe('after a sent transaction', () => {
  it('the form is empty and untouched: nothing is red', () => {
    expect(CLEARED_FIELD).toEqual({ text: '', touched: false })
    expect(amountNote(CLEARED_FIELD, 8, true)).toBe('')
    // The same field once left empty does ask for an amount.
    expect(amountNote({ text: '', touched: true }, 8, true)).not.toBe('')
  })
  describe('the reads that follow', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('at once, after 1.5 s and after 4 s; the last one also reads the transactions; stop cancels', () => {
      expect(AFTER_SEND_READS_MS).toEqual([0, 1500, 4000])
      const read = vi.fn()
      const last = vi.fn()
      scheduleReadsAfterSend(setTimeout, (t) => clearTimeout(t as ReturnType<typeof setTimeout>), read, last)
      vi.advanceTimersByTime(0)
      expect(read).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1500)
      expect(read).toHaveBeenCalledTimes(2)
      expect(last).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2500)
      expect(read).toHaveBeenCalledTimes(3)
      expect(last).toHaveBeenCalledTimes(1)
      const read2 = vi.fn()
      const stop = scheduleReadsAfterSend(setTimeout, (t) => clearTimeout(t as ReturnType<typeof setTimeout>), read2, vi.fn())
      vi.advanceTimersByTime(0)
      stop()
      vi.advanceTimersByTime(5000)
      expect(read2).toHaveBeenCalledTimes(1)
    })
  })
})

describe('added tokens file', () => {
  it('a key that is not a network id (__proto__) is not taken', () => {
    const file = join(h.userData, 'tokens-proto.json')
    writeFileSync(
      file,
      '{"networks":{"__proto__":[{"contract":"evil","symbol":"EVIL","precision":0}],"constructor":[{"contract":"x","symbol":"X","precision":0}],"wax-testnet":[{"contract":"ok","symbol":"OK","precision":2}]}}'
    )
    const s = new AddedTokens(file)
    expect(s.list('wax-testnet')).toEqual([{ contract: 'ok', symbol: 'OK', precision: 2 }])
    expect(s.list('__proto__')).toEqual([])
    expect(s.list('toString')).toEqual([])
    expect(({} as Record<string, unknown>).contract).toBeUndefined()
    expect(s.add('custom-abc', { contract: 'tok', symbol: 'TOK', precision: 0 })).toHaveLength(1)
    expect(() => s.add('__proto__', { contract: 'tok', symbol: 'TOK', precision: 0 })).toThrow()
  })
  it('forgets the tokens of one network', () => {
    const s = new AddedTokens(join(h.userData, 'tokens-forget.json'))
    s.add('custom-abc', { contract: 'tok', symbol: 'TOK', precision: 0 })
    s.add('wax-testnet', { contract: 'tok', symbol: 'TOK', precision: 0 })
    s.forget('custom-abc')
    expect(s.list('custom-abc')).toEqual([])
    expect(s.list('wax-testnet')).toHaveLength(1)
  })
})
