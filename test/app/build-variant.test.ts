import { describe, expect, it } from 'vitest'
import { buildForKind, usesNetworkMacros, variantEnv, variantFits, variantFlags, variantLabel, variantOf } from '../../src/main/build-variant'

describe('testnet and mainnet builds (E64)', () => {
  it('a mainnet takes the mainnet build; a test network and the local chain the testnet build', () => {
    expect(buildForKind('mainnet')).toBe('mainnet')
    expect(buildForKind('testnet')).toBe('testnet')
    expect(buildForKind('local')).toBe('testnet')
  })
  it('the sources decide whether there are two builds', () => {
    const plain = [{ lines: ['void hi();'] }]
    const marked = [{ lines: ['#ifdef WAXMASTER_TESTNET', '  ACTION cleanup();', '#endif'] }]
    expect(usesNetworkMacros(plain)).toBe(false)
    expect(usesNetworkMacros(marked)).toBe(true)
    expect(usesNetworkMacros([{ lines: ['#ifdef WAXMASTER_MAINNET'] }])).toBe(true)
    expect(variantOf(false, 'mainnet')).toBe('any')
    expect(variantOf(true, 'mainnet')).toBe('mainnet')
  })
  it('the compiler gets one -D flag, none for a build that fits every network', () => {
    expect(variantFlags('testnet')).toEqual(['-DWAXMASTER_TESTNET'])
    expect(variantFlags('mainnet')).toEqual(['-DWAXMASTER_MAINNET'])
    expect(variantFlags('any')).toEqual([])
    expect(variantEnv('mainnet')).toEqual({ WAXMASTER_NETWORK: 'mainnet', WAXMASTER_BUILD_FLAG: '-DWAXMASTER_MAINNET' })
  })
  it('a build fits a network when it is that network’s build or fits every network', () => {
    expect(variantFits('any', 'mainnet')).toBe(true)
    expect(variantFits('mainnet', 'mainnet')).toBe(true)
    expect(variantFits('testnet', 'mainnet')).toBe(false)
    expect(variantFits('mainnet', 'testnet')).toBe(false)
    expect(variantLabel('testnet')).toBe('testnet build')
  })
})
