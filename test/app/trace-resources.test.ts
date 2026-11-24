// CPU / NET / RAM refusals are said plainly with the account's resources (E16);
// a timeout or network error is never described as a resource shortage.
import { describe, expect, it } from 'vitest'
import { fromNodeAnswer, fromNodeError, resourceKindOf, withResourceState } from '../../src/main/trace'

const ctx = { source: 'sent' as const, network: 'WAX Testnet', endpoint: 'https://node-a.example' }

function nodeError(name: string, message: string, extra: Record<string, unknown> = {}): unknown {
  return { code: 500, message: 'Internal Service Error', error: { code: 3080004, name, what: 'what', details: [{ message, file: 'x.cpp', line_number: 1, method: 'm' }], ...extra } }
}

const accountAnswer = {
  account_name: 'alice',
  ram_usage: 3000,
  ram_quota: 4096,
  cpu_limit: { used: 9800, available: 200, max: 10000 },
  net_limit: { used: 1200, available: 98_000, max: 99_200 }
}

describe('resource refusals', () => {
  it('names the node errors for CPU, NET and RAM', () => {
    expect(resourceKindOf({ name: 'tx_cpu_usage_exceeded' })?.kind).toBe('cpu')
    expect(resourceKindOf({ name: 'leeway_deadline_exception' })?.kind).toBe('cpu')
    expect(resourceKindOf({ name: 'deadline_exception', stack: [{ format: 'deadline exceeded ${billing_timer}us', data: { billing_timer: 30001 } }] })?.kind).toBe('cpu')
    expect(resourceKindOf({ name: 'deadline_exception', details: [{ message: 'other' }] })).toBeNull()
    expect(resourceKindOf({ name: 'tx_net_usage_exceeded' })?.kind).toBe('net')
    expect(resourceKindOf({ name: 'ram_usage_exceeded' })?.kind).toBe('ram')
    expect(resourceKindOf({ name: 'eosio_assert_message_exception' })).toBeNull()
  })

  it('a CPU refusal says so in one sentence and shows the first authorizer state from the same endpoint', async () => {
    const t = fromNodeError(nodeError('tx_cpu_usage_exceeded', 'billed CPU time (12000 us) is greater than the maximum billable CPU time for the transaction (200 us)'), ctx)
    expect(t.resource?.kind).toBe('cpu')
    const asked: string[] = []
    const r = await withResourceState(t, 'alice', async (a) => {
      asked.push(a)
      return accountAnswer
    })
    expect(asked).toEqual(['alice'])
    expect(r.errorMessage).toMatch(/^Rejected for CPU: alice does not have enough CPU time for this transaction \(alice: CPU 9\.80 ms used, 200 µs available; NET .*; RAM .*\)\.$/)
    expect(r.resource?.state).toEqual({ account: 'alice', cpu: { used: 9800, available: 200, max: 10000 }, net: { used: 1200, available: 98000, max: 99200 }, ram: { used: 3000, quota: 4096 } })
    // The node's own text stays in the full error.
    expect(r.errorStack).toContain('billed CPU time')
  })

  it('NET and RAM refusals; an unreadable account says so', async () => {
    const net = await withResourceState(fromNodeError(nodeError('tx_net_usage_exceeded', 'net usage'), ctx), 'alice', async () => accountAnswer)
    expect(net.errorMessage).toMatch(/^Rejected for NET: alice does not have enough network bandwidth \(NET\)/)
    const ram = await withResourceState(fromNodeError(nodeError('ram_usage_exceeded', 'account bob has insufficient ram; needs 5000 bytes has 4096 bytes'), ctx), 'alice', async () => {
      throw new Error('down')
    })
    expect(ram.errorMessage).toBe('Rejected for RAM: bob does not have enough RAM for this transaction (the resources of alice could not be read).')
    expect(ram.resource?.state).toBeNull()
  })

  it('a CPU except in a trace (simulation answer) is recognised as well', () => {
    const t = fromNodeAnswer({ processed: { except: { name: 'tx_cpu_usage_exceeded', message: 'x', stack: [] }, action_traces: [] } }, { ...ctx, source: 'simulation' })
    expect(t.resource?.kind).toBe('cpu')
    expect(t.errorMessage).toMatch(/^Rejected for CPU/)
  })

  it('a contract error or a timeout is never shown as a resource shortage', async () => {
    const assert = fromNodeError(nodeError('eosio_assert_message_exception', 'assertion failure with message: overdrawn balance'), ctx)
    expect(assert.resource).toBeUndefined()
    expect(assert.errorMessage).toBe('overdrawn balance')
    const same = await withResourceState(assert, 'alice', async () => accountAnswer)
    expect(same).toBe(assert)
    // An HTTP timeout has no node error body; the plain HTTP error has no resource name either.
    const timeout = fromNodeError({ message: 'Request timed out after 30 s' }, ctx)
    expect(timeout.resource).toBeUndefined()
    expect(timeout.errorMessage).not.toMatch(/CPU/)
    const gateway = fromNodeError({ code: 504, message: 'Gateway Timeout', error: { name: 'timeout', what: 'deadline' } }, ctx)
    expect(gateway.resource).toBeUndefined()
  })
})
