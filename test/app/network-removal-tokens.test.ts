// Removing a network removes the tokens added for it; other networks keep theirs.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dataDir: '' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.dataDir, getAppPath: () => h.dataDir, getVersion: () => '0.0.0', on: () => undefined },
  BrowserWindow: class {},
  dialog: {}
}))

describe('removing a network', () => {
  it('forgets its added tokens', async () => {
    h.dataDir = mkdtempSync(join(tmpdir(), 'wm-net-tokens-'))
    vi.resetModules()
    const networks = await import('../../src/main/networks')
    const { addedTokens } = await import('../../src/main/wallet-tokens')
    addedTokens().add('wax-mainnet', { contract: 'alien.worlds', symbol: 'TLM', precision: 4 })
    addedTokens().add('wax-testnet', { contract: 'alien.worlds', symbol: 'TLM', precision: 4 })
    networks.removeNetwork('wax-mainnet')
    expect(addedTokens().list('wax-mainnet')).toEqual([])
    expect(addedTokens().list('wax-testnet')).toHaveLength(1)
  })
})
