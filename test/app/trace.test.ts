import { describe, expect, it } from 'vitest'
import { buildTree, exceptMessage, fromNodeAnswer, fromNodeError } from '../../src/main/trace'

const ctx = { source: 'simulation' as const, network: 'WAX Testnet', endpoint: 'https://testnet.waxsweden.org' }

const transferAnswer = {
  transaction_id: 'abc',
  processed: {
    block_num: 10,
    block_time: '2026-11-24T00:36:24.000',
    receipt: { status: 'executed', cpu_usage_us: 134, net_usage_words: 16 },
    action_traces: [
      {
        action_ordinal: 1,
        creator_action_ordinal: 0,
        receiver: 'eosio.token',
        act: { account: 'eosio.token', name: 'transfer', authorization: [{ actor: 'alice', permission: 'active' }], data: { from: 'alice', to: 'bob' }, hex_data: '00' },
        console: '',
        account_ram_deltas: [],
        except: null
      },
      {
        action_ordinal: 2,
        creator_action_ordinal: 1,
        receiver: 'alice',
        act: { account: 'eosio.token', name: 'transfer', authorization: [], data: { from: 'alice', to: 'bob' } },
        console: ''
      },
      {
        action_ordinal: 3,
        creator_action_ordinal: 1,
        receiver: 'bob',
        act: { account: 'eosio.token', name: 'transfer', authorization: [], data: { from: 'alice', to: 'bob' } },
        console: 'hello'
      },
      {
        action_ordinal: 4,
        creator_action_ordinal: 3,
        receiver: 'logger',
        act: { account: 'logger', name: 'log', authorization: [{ actor: 'bob', permission: 'active' }], data: {} }
      }
    ],
    except: null
  }
}

describe('transaction inspector', () => {
  it('builds the tree with notifications and nested inline actions', () => {
    const t = fromNodeAnswer(transferAnswer, ctx)
    expect(t.status).toBe('executed')
    expect(t.cpuUs).toBe(134)
    expect(t.netBytes).toBe(128)
    expect(t.actions).toHaveLength(1)
    const root = t.actions[0]
    expect(root.notification).toBe(false)
    expect(root.children.map((c) => c.receiver)).toEqual(['alice', 'bob'])
    expect(root.children.every((c) => c.notification)).toBe(true)
    expect(root.children[1].children[0].account).toBe('logger')
    expect(root.children[1].console).toBe('hello')
  })

  it('puts the contract check message first', () => {
    const body = {
      code: 500,
      error: {
        what: 'eosio_assert_message assertion failure',
        details: [{ message: 'assertion failure with message: overdrawn balance' }, { message: 'pending console output: ' }]
      }
    }
    const t = fromNodeError(body, ctx)
    expect(t.status).toBe('failed')
    expect(t.errorMessage).toBe('overdrawn balance')
  })

  it('reads except stacks', () => {
    const e = exceptMessage({ name: 'eosio_assert_message_exception', stack: [{ format: 'assertion failure with message: ${s}', data: { s: 'no balance' } }] })
    expect(e.message).toBe('no balance')
  })

  it('falls back to inline traces when ordinals are missing', () => {
    const nodes = buildTree([{ receiver: 'a', act: { account: 'a', name: 'x' }, inline_traces: [{ receiver: 'b', act: { account: 'b', name: 'y' } }] }])
    expect(nodes[0].children[0].account).toBe('b')
  })
})
