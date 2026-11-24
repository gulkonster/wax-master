import { describe, expect, it } from 'vitest'
import { hasBlockedSwitch } from '../../src/main/switches'

const none = (): boolean => false

describe('blocked start-up switches', () => {
  it('catches one- and two-dash forms, with or without a value', () => {
    for (const a of ['--remote-debugging-port=9222', '-remote-debugging-port=9342', '--inspect', '-inspect-brk=1', '--js-flags=--x', '--disable-web-security', '-ignore-certificate-errors']) {
      expect(hasBlockedSwitch(['app.exe', a], none)).toBe(true)
    }
  })
  it('uses the parser result too', () => {
    expect(hasBlockedSwitch(['app.exe'], (s) => s === 'remote-debugging-pipe')).toBe(true)
  })
  it('lets ordinary arguments through', () => {
    expect(hasBlockedSwitch(['app.exe', 'C:\projects\hello', '--some-other'], none)).toBe(false)
  })
})
