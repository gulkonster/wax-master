// Helpers of the Network page and the network dialogs: the network selected
// after a removal (same rule as the main process), suggested names that never
// take a default network's name, and amounts with thousands separators.

import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../../src/shared/chain-types'
import { groupAmount, nextNetworkAfterRemoval, suggestNetworkName } from '../../src/renderer/src/lib/network-names'

const WAX_MAIN = '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'
const WAX_TEST = 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12'
const OTHER = 'c'.repeat(64)

function net(id: string, name: string, chainId: string): NetworkInfo {
  return { id, name, kind: 'mainnet', chainId, symbol: 'WAX', precision: 8, endpoints: ['https://x.example'], preset: false, currentEndpoint: 0 }
}

describe('network selected after a removal', () => {
  it('the WAX Testnet default, else an entry on the WAX Testnet chain, else the first', () => {
    const own = net('custom-a', 'Other', OTHER)
    const ownTest = net('custom-t', 'My testnet', WAX_TEST)
    const main = net('wax-mainnet', 'WAX Mainnet', WAX_MAIN)
    const test = net('wax-testnet', 'WAX Testnet', WAX_TEST)
    expect(nextNetworkAfterRemoval([main, own, ownTest, test], 'wax-mainnet', WAX_TEST)?.id).toBe('wax-testnet')
    expect(nextNetworkAfterRemoval([main, own, ownTest], 'wax-mainnet', WAX_TEST)?.id).toBe('custom-t')
    expect(nextNetworkAfterRemoval([main, own, test], 'wax-testnet', WAX_TEST)?.id).toBe('wax-mainnet')
    expect(nextNetworkAfterRemoval([main], 'wax-mainnet', WAX_TEST)).toBeNull()
  })
})

describe('suggested names', () => {
  const main = net('wax-mainnet', 'WAX Mainnet', WAX_MAIN)
  const test = net('wax-testnet', 'WAX Testnet', WAX_TEST)
  it('a default name is not suggested for a user network, also while the default is removed', () => {
    const probe = { endpoint: 'https://wax.eosphere.io', chainId: WAX_MAIN, knownName: 'WAX Mainnet' }
    expect(suggestNetworkName(probe, [main, test])).toBe('WAX Mainnet (wax.eosphere.io)')
    expect(suggestNetworkName(probe, [test])).toBe('WAX Mainnet (wax.eosphere.io)')
    expect(suggestNetworkName({ endpoint: 'https://t.example', chainId: WAX_TEST, knownName: 'WAX Testnet' }, [main])).toBe('WAX Testnet (t.example)')
  })
  it('another chain takes its known name or the host', () => {
    expect(suggestNetworkName({ endpoint: 'https://eos.example', chainId: OTHER, knownName: 'Telos' }, [main, test])).toBe('Telos')
    expect(suggestNetworkName({ endpoint: 'https://node.example:8888', chainId: OTHER, knownName: null }, [main, test])).toBe('node.example:8888')
  })
})

describe('amounts with thousands separators', () => {
  it('splits the text at the point; the digits stay as written', () => {
    expect(groupAmount('3770303843.51373505 WAX')).toBe('3,770,303,843.51373505 WAX')
    expect(groupAmount('10000000000.00000000 WAX')).toBe('10,000,000,000.00000000 WAX')
    expect(groupAmount('999.1234 EOS')).toBe('999.1234 EOS')
    expect(groupAmount('1000 TOK')).toBe('1,000 TOK')
    expect(groupAmount('12345678901234567890.1 BIG')).toBe('12,345,678,901,234,567,890.1 BIG')
    expect(groupAmount('-1234.5 X')).toBe('-1,234.5 X')
    expect(groupAmount('n/a')).toBe('n/a')
  })
})
