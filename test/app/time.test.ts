// fmtTime reads a chain time without a zone as UTC and returns unreadable text as it is.

import { describe, expect, it } from 'vitest'
import { fmtTime } from '../../src/renderer/src/lib/time'

describe('fmtTime', () => {
  it('reads a chain time without a zone as UTC', () => {
    expect(fmtTime('2026-11-25T10:00:00.500')).toBe(new Date('2026-11-25T10:00:00.500Z').toLocaleString())
  })
  it('keeps a given zone', () => {
    expect(fmtTime('2026-11-25T10:00:00+02:00')).toBe(new Date('2026-11-25T08:00:00Z').toLocaleString())
  })
  it('returns an unreadable text as it is and empty as empty', () => {
    expect(fmtTime('not a time')).toBe('not a time')
    expect(fmtTime('')).toBe('')
  })
})
