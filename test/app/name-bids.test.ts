import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BID_WARNING,
  bidAmountProblem,
  bidNameProblem,
  bidnameAction,
  bidrefundAction,
  chainTimeIso,
  closingRuleText,
  higherOpenCount,
  NAME_AUCTIONS_MAX,
  nameBidState,
  OPEN_AUCTIONS_LOWER,
  parseBidRefundRow,
  parseNameBidRow,
  parseOpenAuctions,
  smallestNextBid
} from '../../src/shared/name-bids'
import { nameAuctions, nameBidLookup } from '../../src/main/wallet-system'
import { chain, RpcError } from '../../src/main/rpc'
import type { ReadCall } from '../../src/main/contract-view'
import type { NameBidRow, NetworkInfo } from '../../src/shared/chain-types'

type Rows = { rows: Record<string, unknown>[]; more: boolean; next_key?: string }
const fx = JSON.parse(readFileSync(join(__dirname, '../fixtures/chain/name-bids.json'), 'utf8')) as {
  testnet: { namebids: Record<string, unknown>[]; openIndex: Rows; global: Record<string, unknown>; bidrefunds: Record<string, Record<string, unknown>[]> }
  mainnet: { openIndex: Rows; global: Record<string, unknown>; bidrefunds: Record<string, Record<string, unknown>[]> }
}

const RENDERER = join(__dirname, '../../src/renderer/src')

describe('which names can be bid on', () => {
  it('1 to 11 characters of a-z and 1-5 without a dot', () => {
    for (const n of ['a', 'z', '1', 'ab', 'short', 'abcde12345z', 'no1']) expect(bidNameProblem(n), n).toBe('')
  })
  it('each refusal has its own sentence', () => {
    expect(bidNameProblem('')).toBe('Enter a name.')
    expect(bidNameProblem('Abc')).toBe('A name has only the letters a-z and the digits 1-5.')
    expect(bidNameProblem('ab6')).toBe('A name has only the letters a-z and the digits 1-5.')
    expect(bidNameProblem('a b')).toBe('A name has only the letters a-z and the digits 1-5.')
    expect(bidNameProblem('abcdefghijklm')).toBe('A name has at most 12 characters; names of 1 to 11 characters are bid on.')
    expect(bidNameProblem('abcdefghijkl')).toBe('A 12-character name needs no bid: create it in Create account.')
    expect(bidNameProblem('x.name')).toBe('A name with a dot is not bid on: only the account name can create x.name.')
    expect(bidNameProblem('a.b.wam')).toBe('A name with a dot is not bid on: only the account wam can create a.b.wam.')
    expect(bidNameProblem('abc.')).toBe('A name cannot start or end with a dot.')
    expect(bidNameProblem('.abc')).toBe('A name cannot start or end with a dot.')
  })
})

describe('the smallest next bid', () => {
  it('higher than the highest bid by more than a tenth: high + floor(high / 10) + 1', () => {
    expect(smallestNextBid(100_000_000n)).toBe(110_000_001n)
    expect(smallestNextBid(1n)).toBe(2n)
    expect(smallestNextBid(10n)).toBe(12n)
    expect(smallestNextBid(19n)).toBe(21n)
    expect(smallestNextBid(5_500_000_001n)).toBe(6_050_000_002n)
  })
  it('matches the contract check bid - high > high / 10 at the edge', () => {
    for (const high of [1n, 9n, 10n, 11n, 99n, 120_000_000n, 6_668_310_005n]) {
      const min = smallestNextBid(high)
      expect(min - high > high / 10n).toBe(true)
      expect(min - 1n - high > high / 10n).toBe(false)
    }
  })
  it('an amount below it, above the balance or zero is refused in words', () => {
    expect(bidAmountProblem(0n, 1n, null, 'alice', 8, 'WAX')).toBe('Enter a bid above zero.')
    expect(bidAmountProblem(110_000_000n, 110_000_001n, null, 'alice', 8, 'WAX')).toBe(
      'The smallest bid now is 1.10000001 WAX: a new bid must be higher than the highest bid by more than a tenth.'
    )
    expect(bidAmountProblem(200_000_000n, 1n, 100_000_000n, 'alice', 8, 'WAX')).toBe('More than the available balance of alice.')
    expect(bidAmountProblem(110_000_001n, 110_000_001n, 110_000_001n, 'alice', 8, 'WAX')).toBe('')
    expect(bidAmountProblem(1n, 1n, null, 'alice', 8, 'WAX')).toBe('')
  })
})

describe('rows of namebids and bidrefunds', () => {
  it('WAX Testnet rows: all closed, high_bid as number or as text, the amount without its sign', () => {
    const rows = fx.testnet.namebids.map((r) => parseNameBidRow(r))
    expect(rows.every((r) => r !== null && r.closed)).toBe(true)
    expect(rows.find((r) => r!.name === 'blume')).toEqual({ name: 'blume', highBidder: 'rland', highBid: '1', lastBidTime: '2024-01-14T00:58:56.000Z', closed: true })
    expect(rows.find((r) => r!.name === 'blu')!.highBid).toBe('65000000000')
    expect(rows.find((r) => r!.name === '1oa')!.highBid).toBe('210000000')
    expect(parseOpenAuctions(fx.testnet.namebids)).toEqual([])
    expect(parseOpenAuctions(fx.testnet.openIndex.rows)).toEqual([])
  })
  it('WAX Mainnet open rows: highest first', () => {
    const open = parseOpenAuctions(fx.mainnet.openIndex.rows)
    expect(open.length).toBe(fx.mainnet.openIndex.rows.length)
    expect(open[0]).toEqual({ name: 'element', highBidder: 'ferret', highBid: '6668310005', lastBidTime: '2026-11-10T16:06:07.500Z', closed: false })
    expect(open.map((b) => b.name).slice(0, 5)).toEqual(['element', 'ab', 'no1', 'npl', 'nep'])
    for (let i = 1; i < open.length; i++) expect(BigInt(open[i - 1].highBid) >= BigInt(open[i].highBid)).toBe(true)
  })
  it('a row in another form is left out, and nothing throws', () => {
    const good = { newname: 'short', high_bidder: 'alice', high_bid: 100, last_bid_time: '2026-11-24T00:00:00.000' }
    expect(parseNameBidRow(good)).not.toBeNull()
    expect(parseNameBidRow(good, 'other')).toBeNull()
    for (const bad of [
      null,
      'row',
      [good],
      { ...good, high_bid: 0 },
      { ...good, high_bid: '0' },
      { ...good, high_bid: 1.5 },
      { ...good, high_bid: '12e3' },
      { ...good, high_bid: '99999999999999999999' },
      { ...good, newname: 'BAD' },
      { ...good, high_bidder: 7 },
      { ...good, last_bid_time: 'yesterday' }
    ])
      expect(parseNameBidRow(bad), JSON.stringify(bad)).toBeNull()
    expect(parseOpenAuctions([good, { ...good }, { ...good, newname: 'other', high_bid: -5 }, 'x'])).toHaveLength(1)
  })
  it('the refund row of the account only, in the core token at its precision', () => {
    const blu = fx.testnet.bidrefunds.blu
    expect(parseBidRefundRow(blu[1], 'rland', 8, 'WAX')).toBe('2')
    expect(parseBidRefundRow(blu[0], 'gifter.king', 8, 'WAX')).toBe('1000000000')
    expect(parseBidRefundRow(blu[0], 'rland', 8, 'WAX')).toBeNull()
    expect(parseBidRefundRow(fx.mainnet.bidrefunds.no1[0], 'onfqu.wam', 8, 'WAX')).toBe('5000000000')
    expect(parseBidRefundRow({ bidder: 'rland', amount: '1.0000 WAX' }, 'rland', 8, 'WAX')).toBeNull()
    expect(parseBidRefundRow({ bidder: 'rland', amount: '1.00000000 EOS' }, 'rland', 8, 'WAX')).toBeNull()
    expect(parseBidRefundRow({ bidder: 'rland', amount: '-1.00000000 WAX' }, 'rland', 8, 'WAX')).toBeNull()
    expect(parseBidRefundRow(undefined, 'rland', 8, 'WAX')).toBeNull()
  })
  it('chain times are read as UTC', () => {
    expect(chainTimeIso('2026-11-24T00:04:46.000')).toBe('2026-11-24T00:04:46.000Z')
    expect(chainTimeIso('2026-11-24T00:04:46')).toBe('2026-11-24T00:04:46.000Z')
    expect(chainTimeIso(7)).toBeNull()
    expect(chainTimeIso('24.11.2026')).toBeNull()
  })
})

describe('the state of a name for the account that looks at it', () => {
  const open: NameBidRow = { name: 'npl', highBidder: 'roockstaar11', highBid: '5200000000', lastBidTime: '2026-11-24T07:17:56.500Z', closed: false }
  const closed: NameBidRow = { ...open, name: 'blu', highBidder: 'rland', highBid: '65000000000', closed: true }
  it('exists, none, open, own, closed, won', () => {
    expect(nameBidState({ account: 'alice', exists: true, bid: null })).toEqual({ kind: 'exists' })
    expect(nameBidState({ account: 'alice', exists: true, bid: open }).kind).toBe('exists')
    expect(nameBidState({ account: 'alice', exists: false, bid: null })).toEqual({ kind: 'none', minBid: 1n })
    expect(nameBidState({ account: 'alice', exists: false, bid: open })).toEqual({ kind: 'open', bid: open, minBid: 5_720_000_001n })
    expect(nameBidState({ account: 'roockstaar11', exists: false, bid: open })).toEqual({ kind: 'own', bid: open, minBid: 5_720_000_001n })
    expect(nameBidState({ account: 'alice', exists: false, bid: closed })).toEqual({ kind: 'closed', bid: closed })
    expect(nameBidState({ account: 'rland', exists: false, bid: closed })).toEqual({ kind: 'won', bid: closed })
  })
  it('open auctions with a higher bid, from the WAX Mainnet rows', () => {
    const a = { open: parseOpenAuctions(fx.mainnet.openIndex.rows), more: true }
    expect(higherOpenCount(a, 5_200_000_000n, 'npl')).toEqual({ count: 3, atLeast: false })
    expect(higherOpenCount(a, 6_668_310_005n, 'element')).toEqual({ count: 0, atLeast: false })
    // A name without an auction: every open one is higher, and the read was cut.
    expect(higherOpenCount(a, null, 'newname')).toEqual({ count: a.open.length, atLeast: true })
    expect(higherOpenCount({ open: [], more: false }, null, 'newname')).toEqual({ count: 0, atLeast: false })
  })
})

describe('actions and texts', () => {
  it('bidname carries the amount as asset text; bidrefund names the bidder and the name', () => {
    expect(bidnameAction({ bidder: 'alice', permission: 'active', newname: 'short', units: 120_000_000n, precision: 8, symbol: 'WAX' })).toEqual({
      account: 'eosio',
      name: 'bidname',
      authorization: [{ actor: 'alice', permission: 'active' }],
      data: { bidder: 'alice', newname: 'short', bid: '1.20000000 WAX' }
    })
    expect(bidrefundAction({ bidder: 'alice', permission: 'bids', newname: 'short' })).toEqual({
      account: 'eosio',
      name: 'bidrefund',
      authorization: [{ actor: 'alice', permission: 'bids' }],
      data: { bidder: 'alice', newname: 'short' }
    })
  })
  it('the closing rule names the last close when it is known', () => {
    expect(closingRuleText('')).toContain('at most one auction a day')
    expect(closingRuleText('')).not.toContain('last auction closed')
    expect(closingRuleText('24.11.2026, 03:04:46')).toContain('The last auction closed 24.11.2026, 03:04:46.')
  })
  it('the section shows the rule, the warning and the states before anything is sent', () => {
    const src = readFileSync(join(RENDERER, 'pages/account/NameBidsSection.tsx'), 'utf8')
    expect(BID_WARNING).toBe(
      'The bid leaves the account now and goes to eosio.names. It comes back only when somebody outbids you, and then you claim it here. A winning bid is spent. A bid cannot be taken back.'
    )
    expect(src).toContain('{BID_WARNING}')
    expect(src).toContain('closingRuleText(lastClose)')
    expect(src).toContain('window.wax.wallet.nameBid(')
    expect(src).toContain('window.wax.wallet.nameAuctions(')
    expect(src).toContain('The chain refuses a second bid from the highest bidder')
    expect(src).toContain('The highest bid changed since it was read')
    expect(src).toContain('Claim refund')
    expect(src).toContain('onCreate(current.name)')
    // No timer: everything is read on request.
    expect(src).not.toMatch(/setInterval|setTimeout/)
    const body = readFileSync(join(RENDERER, 'pages/account/AccountBody.tsx'), 'utf8')
    expect(body.indexOf("{ id: 'create', label: 'Create account' }")).toBeLessThan(body.indexOf("{ id: 'namebids', label: 'Name bids' }"))
    expect(body).toContain("(s.id !== 'namebids' || system.nameBids)")
  })
})

describe('the two reads', () => {
  const net = (symbol = 'WAX'): NetworkInfo => ({
    id: 'n',
    name: 'Net',
    kind: 'testnet',
    chainId: 'aa'.repeat(32),
    symbol,
    precision: 8,
    endpoints: ['https://node.example'],
    preset: false,
    currentEndpoint: 0
  })
  const readCall: ReadCall = (fn) => fn('https://node.example')
  const unknown = (): Promise<never> =>
    Promise.reject(new RpcError('Account lookup', 400, { error: { name: 'account_query_exception', details: [{ message: 'unable to retrieve account info (unknown key)' }] } }))
  afterEach(() => vi.restoreAllMocks())

  /** get_table_rows answered from the fixture rows of one chain. */
  function tables(c: 'testnet' | 'mainnet') {
    return vi.spyOn(chain, 'getTableRows').mockImplementation(async (_ep, body) => {
      const b = body as Record<string, string | number>
      if (b.table === 'global') return { rows: [fx[c].global], more: false }
      if (b.table === 'bidrefunds') return { rows: (fx[c].bidrefunds[String(b.scope)] ?? []).filter((r) => r.bidder === b.lower_bound), more: false }
      if (b.table === 'namebids' && b.index_position === 2) return fx[c].openIndex
      if (b.table === 'namebids') {
        const all = c === 'testnet' ? fx.testnet.namebids : fx.mainnet.openIndex.rows
        return { rows: all.filter((r) => r.newname === b.lower_bound), more: false }
      }
      return { rows: [], more: false }
    })
  }

  it('WAX Testnet: blu is closed and won by rland, who also has 0.00000002 WAX to claim', async () => {
    tables('testnet')
    vi.spyOn(chain, 'getAccount').mockImplementation(unknown)
    const l = await nameBidLookup(net(), 'blu', 'rland', readCall)
    expect(l).toEqual({
      name: 'blu',
      account: 'rland',
      exists: false,
      bid: { name: 'blu', highBidder: 'rland', highBid: '65000000000', lastBidTime: '2024-01-14T01:02:09.000Z', closed: true },
      refund: '2',
      symbol: 'WAX',
      precision: 8
    })
    expect(nameBidState(l).kind).toBe('won')
    const other = await nameBidLookup(net(), 'blu', 'gifter.king', readCall)
    expect(nameBidState(other).kind).toBe('closed')
    expect(other.refund).toBe('1000000000')
  })
  it('WAX Testnet: a new name has no row; the open auctions are empty; the last close is read', async () => {
    const spy = tables('testnet')
    vi.spyOn(chain, 'getAccount').mockImplementation(unknown)
    const l = await nameBidLookup(net(), 'freshname', 'alice', readCall)
    expect(l.bid).toBeNull()
    expect(l.refund).toBeNull()
    expect(nameBidState(l)).toEqual({ kind: 'none', minBid: 1n })
    const a = await nameAuctions(net(), readCall)
    expect(a).toEqual({ open: [], more: false, lastNameClose: '2026-08-16T22:33:25.500Z', symbol: 'WAX', precision: 8 })
    const body = spy.mock.calls.find((c) => (c[1] as Record<string, unknown>).index_position === 2)![1]
    expect(body).toEqual({
      json: true,
      code: 'eosio',
      scope: 'eosio',
      table: 'namebids',
      index_position: 2,
      key_type: 'i64',
      lower_bound: OPEN_AUCTIONS_LOWER,
      limit: NAME_AUCTIONS_MAX
    })
    expect(NAME_AUCTIONS_MAX).toBe(100)
    expect(OPEN_AUCTIONS_LOWER).toBe(((1n << 64n) - 1n) / 2n + '')
  })
  it('WAX Mainnet: the open auctions highest first, cut, with the last close', async () => {
    tables('mainnet')
    const a = await nameAuctions(net(), readCall)
    expect(a.more).toBe(true)
    expect(a.lastNameClose).toBe('2026-11-24T00:04:46.000Z')
    expect(a.open[0].name).toBe('element')
    expect(a.open.every((b) => !b.closed)).toBe(true)
  })
  it('WAX Mainnet: an open name, its refund row read for the account under the name', async () => {
    const spy = tables('mainnet')
    vi.spyOn(chain, 'getAccount').mockImplementation(unknown)
    const l = await nameBidLookup(net(), 'no1', 'onfqu.wam', readCall)
    expect(l.bid).toMatchObject({ name: 'no1', highBidder: 'ferret', highBid: '5500000001', closed: false })
    expect(l.refund).toBe('5000000000')
    expect(nameBidState(l)).toMatchObject({ kind: 'open', minBid: 6_050_000_002n })
    const refundBody = spy.mock.calls.find((c) => (c[1] as Record<string, unknown>).table === 'bidrefunds')![1]
    expect(refundBody).toMatchObject({ code: 'eosio', scope: 'no1', table: 'bidrefunds', lower_bound: 'onfqu.wam', upper_bound: 'onfqu.wam', limit: 1 })
  })
  it('an existing account is "exists"; a failed account read is an error, not "free"', async () => {
    tables('mainnet')
    vi.spyOn(chain, 'getAccount').mockResolvedValue({ account_name: 'eosio' })
    expect(nameBidState(await nameBidLookup(net(), 'eosio', 'alice', readCall)).kind).toBe('exists')
    vi.spyOn(chain, 'getAccount').mockRejectedValue(new RpcError('timeout', 0))
    await expect(nameBidLookup(net(), 'short', 'alice', readCall)).rejects.toThrow('timeout')
  })
  it('a chain whose global table has no close yet, or does not answer, gives an empty last close', async () => {
    vi.spyOn(chain, 'getTableRows').mockImplementation(async (_ep, body) =>
      (body as Record<string, unknown>).table === 'global' ? { rows: [{ last_name_close: '2000-01-01T00:00:00.000' }], more: false } : { rows: [], more: false }
    )
    expect((await nameAuctions(net(), readCall)).lastNameClose).toBe('')
    vi.spyOn(chain, 'getTableRows').mockImplementation(async (_ep, body) => {
      if ((body as Record<string, unknown>).table === 'global') throw new Error('no answer')
      return { rows: [], more: false }
    })
    expect((await nameAuctions(net(), readCall)).lastNameClose).toBe('')
  })
})
