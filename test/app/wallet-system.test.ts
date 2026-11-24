import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameToUint64 } from '../../src/chain-core'
import type { AbiDef } from '../../src/chain-core'
import { claimAction, claimChoices, MAX_VOTE_PRODUCERS, nameValue, sortNames, voteAction, voterRewardEstimate } from '../../src/shared/wallet-voting'
import { amountForFrac, decayedAdjusted, fracForStake, POWERUP_FRAC, powerupAction, powerupFee, powerupQuote, type PowerupResource, type PowerupState } from '../../src/shared/powerup'
import { actionsQuery, checkActionsFilter, dayEnd, dayStart, filterOf, pageCount } from '../../src/shared/history-filter'
import { claimViews, parsePowerupState, parseProducers, parseVoter, systemFeatures } from '../../src/main/wallet-system'

const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/chain/wax-testnet-eosio-system.json'), 'utf8')) as {
  actions: string[]
  tables: string[]
  powupState: Record<string, unknown>
}

function abiOf(actions: string[], tables: string[]): AbiDef {
  return {
    version: 'eosio::abi/1.2',
    types: [],
    structs: [],
    actions: actions.map((name) => ({ name, type: name, ricardian_contract: '' })),
    tables: tables.map((name) => ({ name, index_type: 'i64', key_names: [], key_types: [], type: name })),
    ricardian_clauses: [],
    error_messages: [],
    abi_extensions: []
  } as AbiDef
}

/** A chain with the reference system contract: voting without voter rewards, no PowerUp market. */
const STANDARD_ACTIONS = ['voteproducer', 'regproxy', 'claimrewards', 'delegatebw', 'undelegatebw', 'buyrambytes', 'refund']
const STANDARD_TABLES = ['producers', 'voters', 'global', 'delband', 'refunds']

describe('vote building', () => {
  it('name order is the order of the 64-bit name value', () => {
    for (const n of ['a', 'zz', '1', 'eosio', 'eosio.token', 'a.b', 'zzzzzzzzzzzzj', 'aaaaaaaaaaaa']) expect(nameValue(n)).toBe(nameToUint64(n))
    expect(sortNames(['zeta', 'alpha', 'a.b', 'a', '1abc', 'alohaeosprod'])).toEqual(['1abc', 'a', 'a.b', 'alohaeosprod', 'alpha', 'zeta'])
  })
  it('producers: unique, sorted by name, no proxy', () => {
    const r = voteAction('alice', 'active', { kind: 'producers', producers: ['zeta', 'alpha', 'zeta', 'beta'] })
    expect('action' in r && r.action).toEqual({
      account: 'eosio',
      name: 'voteproducer',
      authorization: [{ actor: 'alice', permission: 'active' }],
      data: { voter: 'alice', proxy: '', producers: ['alpha', 'beta', 'zeta'] }
    })
  })
  it('at most the limit of producers', () => {
    const names = Array.from({ length: MAX_VOTE_PRODUCERS + 1 }, (_, i) => `prod${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'12345'[Math.floor(i / 26)]}`)
    expect(new Set(names).size).toBe(31)
    expect(voteAction('alice', 'active', { kind: 'producers', producers: names })).toEqual({ problem: 'Choose at most 30 producers (31 chosen).' })
    expect('action' in voteAction('alice', 'active', { kind: 'producers', producers: names.slice(0, 30) })).toBe(true)
    expect(MAX_VOTE_PRODUCERS).toBe(30)
  })
  it('proxy: names no producers; not the voter itself; a valid name', () => {
    const r = voteAction('alice', 'active', { kind: 'proxy', proxy: ' proxy4nation ' })
    expect('action' in r && r.action.data).toEqual({ voter: 'alice', proxy: 'proxy4nation', producers: [] })
    expect(voteAction('alice', 'active', { kind: 'proxy', proxy: 'alice' })).toEqual({ problem: 'An account cannot be its own proxy.' })
    expect('problem' in voteAction('alice', 'active', { kind: 'proxy', proxy: 'Not A Name' })).toBe(true)
  })
  it('refuses bad names and an empty permission', () => {
    expect('problem' in voteAction('alice', 'active', { kind: 'producers', producers: ['BAD'] })).toBe(true)
    expect('problem' in voteAction('BAD', 'active', { kind: 'producers', producers: [] })).toBe(true)
    expect('problem' in voteAction('alice', '', { kind: 'producers', producers: [] })).toBe(true)
  })
  it('an empty producer list removes the vote', () => {
    const r = voteAction('alice', 'active', { kind: 'producers', producers: [] })
    expect('action' in r && r.action.data).toEqual({ voter: 'alice', proxy: '', producers: [] })
  })
})

describe('claim actions from the system ABI', () => {
  it('WAX Testnet ABI: voterclaim, and claimgenesis only with a genesis row', () => {
    expect(fixture.actions).toContain('voterclaim')
    expect(claimChoices(fixture.actions, false).map((c) => c.action)).toEqual(['voterclaim'])
    expect(claimChoices(fixture.actions, true).map((c) => c.action)).toEqual(['voterclaim', 'claimgenesis'])
  })
  it('claimgbmvote only when voterclaim is missing; nothing on a chain without them', () => {
    expect(claimChoices(['voteproducer', 'claimgbmvote'], false).map((c) => c.action)).toEqual(['claimgbmvote'])
    expect(claimChoices(STANDARD_ACTIONS, true)).toEqual([])
  })
  it('the claim action names the account in its own field', () => {
    const [vc, cg] = claimChoices(fixture.actions, true)
    expect(claimAction(vc, 'alice', 'active')?.data).toEqual({ owner: 'alice' })
    expect(claimAction(cg, 'alice', 'claim')).toEqual({ account: 'eosio', name: 'claimgenesis', authorization: [{ actor: 'alice', permission: 'claim' }], data: { claimer: 'alice' } })
    expect(claimAction(vc, 'BAD', 'active')).toBeNull()
  })
  it('features: voting and PowerUp on WAX Testnet; voting only on the reference contract; nothing without an ABI', async () => {
    const row = async (): Promise<unknown> => ({ rows: [fixture.powupState], more: false })
    expect(await systemFeatures(abiOf(fixture.actions, fixture.tables), row)).toEqual({ voting: true, powerup: true })
    expect(await systemFeatures(abiOf(STANDARD_ACTIONS, STANDARD_TABLES), row)).toEqual({ voting: true, powerup: false })
    expect(await systemFeatures(abiOf(fixture.actions, fixture.tables), async () => ({ rows: [] }))).toEqual({ voting: true, powerup: false })
    expect(await systemFeatures(abiOf(fixture.actions, fixture.tables), async () => Promise.reject(new Error('x')))).toEqual({ voting: true, powerup: false })
    expect(await systemFeatures(null, row)).toEqual({ voting: false, powerup: false })
  })
})

describe('voter reward estimate', () => {
  const base = {
    unpaidVoteshare: 100,
    unpaidVoteshareLastUpdated: 0,
    unpaidVoteshareChangeRate: 0,
    totalUnpaidVoteshare: 1000,
    totalUnpaidVoteshareLastUpdated: 0,
    totalVoteshareChangeRate: 0,
    votersBucket: 50_000
  }
  it('bucket times the share of all unpaid shares', () => {
    expect(voterRewardEstimate(base, 0)).toBe(5000n)
  })
  it('both shares carried forward to now', () => {
    // After 10 s: share 100 + 10 * 10 = 200, total 1000 + 10 * 100 = 2000.
    expect(voterRewardEstimate({ ...base, unpaidVoteshareChangeRate: 10, totalVoteshareChangeRate: 100 }, 10_000)).toBe(5000n)
    expect(voterRewardEstimate({ ...base, unpaidVoteshareChangeRate: 30, totalVoteshareChangeRate: 100 }, 10_000)).toBe(10_000n)
  })
  it('null when a number is missing; zero without a share', () => {
    expect(voterRewardEstimate({ ...base, votersBucket: NaN }, 0)).toBeNull()
    expect(voterRewardEstimate({ ...base, totalUnpaidVoteshare: 0 }, 0)).toBeNull()
    expect(voterRewardEstimate({ ...base, unpaidVoteshare: 0 }, 0)).toBe(0n)
  })
  it('claim views: the estimate in words, the day rule, an account that never voted', () => {
    const voter = {
      owner: 'alice',
      unpaid_voteshare: '100.0',
      unpaid_voteshare_last_updated: '2026-11-24T00:00:00.000',
      unpaid_voteshare_change_rate: '0.0',
      last_claim_time: '2026-11-24T00:00:00.000'
    }
    const global = {
      total_unpaid_voteshare: '1000.0',
      total_unpaid_voteshare_last_updated: '2026-11-24T00:00:00.000',
      total_voteshare_change_rate: '0.0',
      voters_bucket: '50000000'
    }
    const head = Date.parse('2026-11-24T12:00:00Z')
    const [v] = claimViews(fixture.actions, voter, global, undefined, head, 8, 'WAX')
    expect(v.dueText).toContain('About 0.05000000 WAX')
    expect(v.timeNote).toContain('next from 2026-11-25T00:00:00Z')
    const [none] = claimViews(fixture.actions, undefined, global, undefined, head, 8, 'WAX')
    expect(none.dueText).toContain('has not voted')
    const [, g] = claimViews(fixture.actions, voter, global, { balance: '10.00000000 WAX', unclaimed_balance: '1.00000000 WAX' }, head, 8, 'WAX')
    expect(g.action).toBe('claimgenesis')
    expect(g.dueText).toContain('cannot be estimated exactly')
    expect(g.dueText).toContain('1.00000000 WAX')
  })
})

describe('producers and voters rows are checked', () => {
  it('active producers only, most votes first, shares in percent; bad rows left out', () => {
    const r = parseProducers([
      { owner: 'low', total_votes: '100.0', is_active: 1 },
      { owner: 'high', total_votes: '300.0', is_active: 1 },
      { owner: 'off', total_votes: '900.0', is_active: 0 },
      { owner: 'BAD NAME', total_votes: '900.0', is_active: 1 },
      { owner: 'nan', total_votes: 'many', is_active: 1 },
      { owner: 'high', total_votes: '999.0', is_active: 1 }
    ])
    expect(r.producers).toEqual([
      { name: 'high', votePercent: 75 },
      { name: 'low', votePercent: 25 }
    ])
    expect(r.cut).toBe(false)
    expect(parseProducers([{ owner: 'a', total_votes: '1', is_active: 1 }, { owner: 'b', total_votes: '2', is_active: 1 }], 1)).toEqual({ producers: [{ name: 'b', votePercent: (2 / 3) * 100 }], cut: true })
  })
  it('the voter row of the account only; names checked; stake formatted', () => {
    expect(parseVoter({ owner: 'bob' }, 'alice', 8, 'WAX')).toBeNull()
    expect(parseVoter({ owner: 'alice', proxy: '', producers: ['b', 'BAD', 7, 'a'], staked: '150000000', is_proxy: 0 }, 'alice', 8, 'WAX')).toEqual({
      proxy: '',
      producers: ['b', 'a'],
      staked: '1.50000000 WAX',
      isProxy: false
    })
    expect(parseVoter({ owner: 'alice', proxy: '<b>x</b>', producers: 'x', staked: -1 }, 'alice', 8, 'WAX')).toEqual({ proxy: '', producers: [], staked: '', isProxy: false })
  })
})

/** A simple market: weight 2^20 (shares exact in binary), prices 1000 to 101000 units, exponent 2. */
const simple: PowerupResource = {
  weight: '1048576',
  utilization: '0',
  adjustedUtilization: '0',
  utilizationTimestamp: 1000,
  decaySecs: 86400,
  exponent: 2,
  minPrice: '1000',
  maxPrice: '101000'
}
const EIGHTH = 131_072

describe('PowerUp cost', () => {
  it('fee is the integral of the price: f(u) = min * u + (max - min) / exponent * u^exponent, rounded up', () => {
    // u from 0 to 0.125: 1000 * 0.125 + 50000 * 0.015625 = 906.25 -> 907
    expect(powerupFee(simple, EIGHTH, 0)).toBe(907)
    // u from 0.5 to 0.625: 125 + 50000 * (0.390625 - 0.25) = 7156.25 -> 7157
    expect(powerupFee({ ...simple, utilization: '524288', adjustedUtilization: '524288' }, EIGHTH, 524_288)).toBe(7157)
    expect(powerupFee(simple, 0, 0)).toBe(0)
  })
  it('below adjusted utilization the price at adjusted applies; above it the integral', () => {
    // p(0.25) = 1000 + 100000 * 0.25 = 26000; 26000 * 0.125 = 3250
    expect(powerupFee(simple, EIGHTH, 262_144)).toBe(3250)
    // 26000 * 0.25 = 6500, then 0.25 to 0.375: 125 + 50000 * (0.140625 - 0.0625) = 4031.25; total 10531.25 -> 10532
    expect(powerupFee(simple, 3 * EIGHTH, 262_144)).toBe(10_532)
  })
  it('refused beyond the weight or without weight', () => {
    expect(powerupFee(simple, 1, 0)).toBe(1)
    expect(powerupFee(simple, 1_048_577, 0)).toBeNull()
    expect(powerupFee({ ...simple, weight: '0' }, 1, 0)).toBeNull()
  })
  it('adjusted utilization decays toward utilization with e^(-t / decay_secs)', () => {
    const r = { ...simple, adjustedUtilization: '200000' }
    expect(decayedAdjusted(r, 1000)).toBe(200_000)
    expect(decayedAdjusted(r, 1000 + 86400)).toBe(Math.floor(200_000 * Math.exp(-1)))
    expect(decayedAdjusted({ ...simple, utilization: '300000', adjustedUtilization: '200000' }, 5000)).toBe(300_000)
  })
  it('fractions: stake share of the weight, as the contract turns them back into weight', () => {
    expect(fracForStake(BigInt(EIGHTH), simple)).toBe(POWERUP_FRAC / 8n)
    expect(amountForFrac(POWERUP_FRAC / 8n, simple)).toBe(BigInt(EIGHTH))
    expect(fracForStake(0n, simple)).toBe(0n)
  })
  const state = (r: PowerupResource): PowerupState => ({ net: r, cpu: r, days: 1, minFee: '1', symbol: 'WAX', precision: 8 })
  it('quote: fee of both resources, max_payment = fee plus 5 % rounded up (at least one unit)', () => {
    const q = powerupQuote(state(simple), BigInt(EIGHTH), BigInt(EIGHTH), 1000)
    expect(q.problem).toBe('')
    expect(q.cpuFrac).toBe(POWERUP_FRAC / 8n)
    expect(q.fee).toBe(1814n)
    expect(q.maxPayment).toBe(1814n + 91n)
    expect(powerupQuote(state(simple), 16n, 0n, 1000).maxPayment).toBe(2n)
  })
  it('quote refusals in words', () => {
    expect(powerupQuote(state(simple), 0n, 0n, 1000).problem).toBe('Enter an amount for CPU or for NET.')
    expect(powerupQuote(state({ ...simple, weight: '1000000000000000000' }), 1n, 0n, 1000).problem).toBe('The amount is too small for this market.')
    expect(powerupQuote(state(simple), 2_000_000n, 0n, 1000).problem).toBe('The CPU market does not have that much left to rent.')
    expect(powerupQuote({ ...state(simple), minFee: '100000' }, 1n, 0n, 1000).problem).toContain('below the smallest fee')
  })
  it('WAX Testnet row: checked, and 10 WAX of CPU costs about 0.000275 WAX', () => {
    const s = parsePowerupState(fixture.powupState, Date.parse('2026-11-24T18:00:00Z') / 1000, 8, 'WAX')
    expect(s).not.toBeNull()
    expect(s!.cpu.minPrice).toBe('875000000000')
    expect(s!.days).toBe(1)
    expect(s!.minFee).toBe('1')
    const q = powerupQuote(s!, 1_000_000_000n, 0n, s!.headTime)
    expect(q.problem).toBe('')
    // By hand: u = 402280236098695 / 40868910230280470 = 0.0098432; p(u) = 8.75e11 + 2.5375e13 * u = 1.12477e12 units;
    // fee = p(u) * 1e9 / 40868910230280470 = about 27522 units.
    expect(Number(q.fee)).toBeGreaterThan(27_000)
    expect(Number(q.fee)).toBeLessThan(28_000)
    const a = powerupAction({ payer: 'alice', receiver: 'bob', permission: 'active', days: 1, quote: q, maxPaymentText: '0.00028898 WAX' })
    expect(a.data).toMatchObject({ payer: 'alice', receiver: 'bob', days: 1, net_frac: '0', max_payment: '0.00028898 WAX' })
  })
  it('a row in another form is refused', () => {
    const p = fixture.powupState
    expect(parsePowerupState(undefined, 0, 8, 'WAX')).toBeNull()
    expect(parsePowerupState({ ...p, min_powerup_fee: '0.0001 EOS' }, 0, 8, 'WAX')).toBeNull()
    expect(parsePowerupState({ ...p, powerup_days: 0 }, 0, 8, 'WAX')).toBeNull()
    expect(parsePowerupState({ ...p, cpu: { ...(p.cpu as object), weight: '-5' } }, 0, 8, 'WAX')).toBeNull()
    expect(parsePowerupState({ ...p, cpu: { ...(p.cpu as object), exponent: 'x' } }, 0, 8, 'WAX')).toBeNull()
    expect(parsePowerupState({ ...p, net: null }, 0, 8, 'WAX')).toBeNull()
  })
})

describe('transaction filters', () => {
  it('checked filter: action name, UTC times, start not after end', () => {
    expect(checkActionsFilter(undefined)).toEqual({})
    expect(checkActionsFilter({ action: '', after: '' })).toEqual({})
    expect(checkActionsFilter({ action: 'transfer', after: '2026-11-01T00:00:00.000Z', before: '2026-11-24T23:59:59.999Z' })).toEqual({
      action: 'transfer',
      after: '2026-11-01T00:00:00.000Z',
      before: '2026-11-24T23:59:59.999Z'
    })
    for (const bad of [
      'text',
      [1],
      { action: 'Transfer' },
      { action: 'a&b=c' },
      { action: 7 },
      { after: '2026-11-01' },
      { before: 'tomorrow' },
      { after: '2026-11-24T00:00:00Z', before: '2026-11-01T00:00:00Z' },
      { after: 'x'.repeat(40) }
    ])
      expect(() => checkActionsFilter(bad), JSON.stringify(bad)).toThrow()
  })
  it('query of the history service', () => {
    expect(actionsQuery({})).toBe('')
    expect(actionsQuery({ action: 'transfer' })).toBe('&filter=*%3Atransfer')
    expect(actionsQuery({ after: '2026-11-01T00:00:00.000Z', before: '2026-11-02T00:00:00.000Z' })).toBe('&after=2026-11-01T00%3A00%3A00.000Z&before=2026-11-02T00%3A00%3A00.000Z')
  })
  it('fields to filter: local days to UTC times; problems in words', () => {
    expect(dayStart('2026-11-24')).toBe(new Date('2026-11-24T00:00:00').toISOString())
    expect(dayEnd('2026-11-24')).toBe(new Date('2026-11-24T23:59:59.999').toISOString())
    expect(dayStart('24.11.2026')).toBe('')
    expect(filterOf(' transfer ', '', '')).toEqual({ filter: { action: 'transfer' } })
    expect(filterOf('', '2026-11-24', '2026-11-24')).toEqual({ filter: { after: dayStart('2026-11-24'), before: dayEnd('2026-11-24') } })
    expect(filterOf('BAD', '', '')).toHaveProperty('problem')
    expect(filterOf('', '2026-11-25', '2026-11-24')).toEqual({ problem: 'The first day is after the last day.' })
    for (const f of [filterOf('transfer', '2026-11-01', '2026-11-24')]) if ('filter' in f) expect(checkActionsFilter(f.filter)).toEqual(f.filter)
  })
  it('pages', () => {
    expect(pageCount(0)).toBe(0)
    expect(pageCount(20)).toBe(1)
    expect(pageCount(21)).toBe(2)
  })
})
