// The refund's "Can be claimed from" time is the chain's due time: two renders
// ten minutes apart show the same time.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccountView } from '../../src/shared/chain-types'

// The component is a .tsx file; the test settings have no JSX, so it is loaded by path.
const SECTION = '../../src/renderer/src/pages/account/CpuNetSection'
const loadRefund = async (): Promise<FunctionComponent<{ ctx: unknown }>> =>
  ((await import(/* @vite-ignore */ SECTION)) as { Refund: FunctionComponent<{ ctx: unknown }> }).Refund

const view = {
  name: 'urhfdara4d4a',
  symbol: 'WAX',
  refund: '10.00000000 WAX',
  refundCpu: '5.00000000 WAX',
  refundNet: '5.00000000 WAX',
  refundRequested: '2026-11-25T05:45:30',
  refundDue: '2026-11-28T05:45:30.000Z',
  refundSecondsLeft: 3 * 24 * 3600 - 600,
  refundExact: true,
  control: ['active']
} as unknown as AccountView

const ctx = { view, viewOnly: false, reason: '', reload: () => undefined, afterSend: () => undefined, readTick: 0 }

afterEach(() => {
  vi.useRealTimers()
})

describe('refund due time', () => {
  it('two renders ten minutes apart show the same chain time', async () => {
    const Refund = await loadRefund()
    const dueLine = (): string => {
      const html = renderToStaticMarkup(createElement(Refund, { ctx }))
      const m = /Can be claimed from ([^<]+)\./.exec(html)
      expect(m).not.toBeNull()
      return m![1]
    }
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T05:55:30Z'))
    const first = dueLine()
    vi.setSystemTime(new Date('2026-11-25T06:05:30Z'))
    const second = dueLine()
    expect(second).toBe(first)
    expect(first).toBe(new Date('2026-11-28T05:45:30.000Z').toLocaleString())
  })
})
