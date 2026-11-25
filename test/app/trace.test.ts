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

  it('never takes the pending console line for the error', () => {
    const except = {
      code: 3050010,
      name: 'unauthorized_ram_usage_increase',
      message: 'Action attempts to increase RAM usage of account without authorization',
      stack: [
        { format: 'unprivileged contract cannot increase RAM usage of another account that has not authorized the action: ${account}', data: { account: 'bob' } },
        { format: '${receiver} <= ${account}::${action} pending console output: ${console}', data: { receiver: 'alice', account: 'alice', action: 'put', console: '' } }
      ]
    }
    expect(exceptMessage(except).message).toBe('unprivileged contract cannot increase RAM usage of another account that has not authorized the action: bob')
    const t = fromNodeAnswer({ processed: { except, action_traces: [] } }, ctx)
    expect(t.errorMessage).toBe('unprivileged contract cannot increase RAM usage of another account that has not authorized the action: bob')
    // Only the context line: the exception's own message.
    expect(exceptMessage({ name: 'x', message: 'missing authority', stack: [except.stack[1]] }).message).toBe('missing authority')
    const body = {
      code: 500,
      error: { what: 'Missing required authority', details: [{ message: 'alice <= alice::put pending console output: ' }, { message: 'missing authority of bob' }] }
    }
    expect(fromNodeError(body, ctx).errorMessage).toBe('missing authority of bob')
  })

  it('falls back to inline traces when ordinals are missing', () => {
    const nodes = buildTree([{ receiver: 'a', act: { account: 'a', name: 'x' }, inline_traces: [{ receiver: 'b', act: { account: 'b', name: 'y' } }] }])
    expect(nodes[0].children[0].account).toBe('b')
    expect(nodes[0].kind).toBe('action')
    expect(nodes[0].placed).toBe('top')
    expect(nodes[0].children[0].kind).toBe('inline')
    expect(nodes[0].children[0].placed).toBe('link')
  })

  it('gives each node its kind, sequence, key and placement', () => {
    const t = fromNodeAnswer(transferAnswer, ctx)
    const root = t.actions[0]
    expect([root.kind, root.placed, root.sequence, root.key]).toEqual(['action', 'top', null, 'o1'])
    expect(root.children.map((c) => [c.kind, c.placed])).toEqual([
      ['notification', 'link'],
      ['notification', 'link']
    ])
    expect(root.children[1].children[0].kind).toBe('inline')
    expect(root.children[1].children[0].placed).toBe('link')
  })

  it('puts children in the order of execution, not of ordinals', () => {
    // The contract sent its inline action before it notified: the inline action has
    // the lower ordinal, but the notifications ran first (global sequence).
    const trace = (ordinal: number, creator: number, receiver: string, account: string, name: string, seq: number | string) => ({
      action_ordinal: ordinal,
      creator_action_ordinal: creator,
      receiver,
      receipt: { receiver, global_sequence: seq },
      act: { account, name, authorization: [{ actor: account, permission: 'active' }], data: {} }
    })
    const answer = {
      transaction_id: 'def',
      processed: {
        receipt: { status: 'executed' },
        action_traces: [
          trace(1, 0, 'game', 'game', 'reward', 100),
          trace(2, 1, 'game', 'game', 'logreward', '103'),
          trace(3, 1, 'player', 'game', 'reward', 101),
          trace(4, 1, 'listener', 'game', 'reward', '102'),
          trace(5, 2, 'player', 'game', 'logreward', 104)
        ]
      }
    }
    const t = fromNodeAnswer(answer, ctx)
    expect(t.actions).toHaveLength(1)
    const root = t.actions[0]
    expect(root.children.map((c) => `${c.receiver}:${c.name}:${c.kind}`)).toEqual([
      'player:reward:notification',
      'listener:reward:notification',
      'game:logreward:inline'
    ])
    expect(root.children.map((c) => c.key)).toEqual(['101', '102', '103'])
    expect(root.children[2].children[0].receiver).toBe('player')
    // Numeric, not text order.
    const big = buildTree([trace(1, 0, 'a', 'a', 'x', 9), trace(2, 1, 'a', 'a', 'y', 11), trace(3, 1, 'a', 'a', 'z', 10)])
    expect(big[0].children.map((c) => c.name)).toEqual(['z', 'y'])
  })

  it('keeps the node answer as the Raw block', () => {
    const t = fromNodeAnswer(transferAnswer, ctx)
    expect(t.raw).toEqual([{ title: 'Node answer', text: JSON.stringify(transferAnswer, null, 2) }])
    const body = { code: 500, error: { what: 'x', details: [] } }
    expect(fromNodeError(body, ctx).raw).toEqual([{ title: 'Node answer', text: JSON.stringify(body, null, 2) }])
    const huge = { processed: { action_traces: [], console: 'x'.repeat(2_100_000) } }
    expect(fromNodeAnswer(huge, ctx).raw[0].text).toHaveLength(2_000_000)
  })
})
