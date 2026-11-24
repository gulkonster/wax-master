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

describe('blocked start-up switches: debugging address and inspector port', () => {
  it('catches remote-debugging-address and inspect-port in both forms, with and without a value', () => {
    for (const a of [
      '--remote-debugging-address=0.0.0.0',
      '-remote-debugging-address=0.0.0.0',
      '--remote-debugging-address',
      '--inspect-port=9230',
      '-inspect-port=9230',
      '-inspect-port',
      '--INSPECT-PORT=1'
    ]) {
      expect(hasBlockedSwitch(['app.exe', a], none), a).toBe(true)
    }
  })
  it('catches them through the parser too', () => {
    expect(hasBlockedSwitch(['app.exe'], (s) => s === 'remote-debugging-address')).toBe(true)
    expect(hasBlockedSwitch(['app.exe'], (s) => s === 'inspect-port')).toBe(true)
  })
  it('does not match longer names or values that only contain a switch name', () => {
    expect(hasBlockedSwitch(['app.exe', '--inspect-ports-are-fine', 'C:\inspect-port=1'], none)).toBe(false)
  })
})

describe('start-up refusal is logged before the app exits', () => {
  it('index.ts writes one log line, after the log file is set up, before app.exit(1)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/main/index.ts', 'utf8')
    const sink = src.indexOf('setLogSink(')
    const check = src.indexOf('hasBlockedSwitch(process.argv')
    const logLine = src.indexOf('log.error(', check)
    const exit = src.indexOf('app.exit(1)', check)
    expect(sink).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(sink)
    expect(logLine).toBeGreaterThan(check)
    expect(exit).toBeGreaterThan(logLine)
  })
})
