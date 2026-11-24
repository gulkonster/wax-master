// RAM estimate of a deployment: the chain bills the difference to what the
// account already holds, so a redeployment needs only the bytes it adds.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dataDir, isPackaged: false, getAppPath: () => h.dataDir }, BrowserWindow: class {}, dialog: {} }))
import { base64Size, chainCodeSize, deployRam } from '../../src/main/deploy'
import { CODE_SIZE_UNREAD, deployRamText, ramToBuy } from '../../src/shared/ram-market'

const n = (x: number): string => x.toLocaleString()

describe('bytes held by base64 text', () => {
  it('counts with and without the padding', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 15_488, 17_525]) {
      const b64 = Buffer.alloc(len, 7).toString('base64')
      expect(base64Size(b64)).toBe(len)
      expect(base64Size(b64.replace(/=+$/, ''))).toBe(len)
    }
    expect(base64Size(undefined)).toBe(0)
    expect(base64Size('')).toBe(0)
  })
})

describe('needed bytes', () => {
  it('first deployment: 10 x the code plus the ABI, as before', () => {
    const r = deployRam({ sendWasm: true, wasmSize: 15_488, chainCodeSize: 0, sendAbi: true, abiSize: 3_310, chainAbiSize: 0 })
    expect(r).toEqual({ needed: 154_880 + 3_310, newBytes: 158_190, replacedBytes: 0 })
    expect(deployRamText({ ramNeeded: r.needed, ramNew: r.newBytes, ramReplaced: r.replacedBytes, ramAvailable: 200_000, chainCodeUnread: false })).toBe(
      `RAM needed about ${n(158_190)} bytes; available ${n(200_000)} bytes.`
    )
  })

  it('larger redeployment: only the difference (code 15,488 to 17,525 bytes, ABI +735)', () => {
    const r = deployRam({ sendWasm: true, wasmSize: 17_525, chainCodeSize: 15_488, sendAbi: true, abiSize: 3_310 + 735, chainAbiSize: 3_310 })
    expect(r.needed).toBe(21_105)
    expect(r.newBytes).toBe(175_250 + 4_045)
    expect(r.replacedBytes).toBe(154_880 + 3_310)
    const text = deployRamText({ ramNeeded: r.needed, ramNew: r.newBytes, ramReplaced: r.replacedBytes, ramAvailable: 15_598, chainCodeUnread: false })
    expect(text).toBe(`RAM needed about ${n(21_105)} bytes more than now (new code and ABI ${n(179_295)} bytes, replacing ${n(158_190)} bytes); available ${n(15_598)} bytes.`)
    // Buy RAM is prefilled from the new value by the unchanged rule.
    expect(ramToBuy(r.needed, 15_598)).toBe(8_192)
  })

  it('smaller redeployment: 0', () => {
    const r = deployRam({ sendWasm: true, wasmSize: 12_000, chainCodeSize: 15_488, sendAbi: true, abiSize: 3_000, chainAbiSize: 3_310 })
    expect(r.needed).toBe(0)
    expect(r.replacedBytes).toBeGreaterThan(r.newBytes)
  })

  it('only the ABI changed: the ABI difference, the code is not counted', () => {
    const r = deployRam({ sendWasm: false, wasmSize: 17_525, chainCodeSize: 17_525, sendAbi: true, abiSize: 4_045, chainAbiSize: 3_310 })
    expect(r).toEqual({ needed: 735, newBytes: 4_045, replacedBytes: 3_310 })
  })

  it('unlimited RAM is said so', () => {
    expect(deployRamText({ ramNeeded: 10, ramNew: 10, ramReplaced: 0, ramAvailable: -1, chainCodeUnread: false })).toBe('RAM needed about 10 bytes; available unlimited.')
  })
})

describe('the size of the code on the account', () => {
  it('is not read for an account without code', async () => {
    const read = vi.fn(async () => ({ wasm: 'AAAA' }))
    expect(await chainCodeSize(false, read)).toEqual({ size: 0, unread: false })
    expect(read).not.toHaveBeenCalled()
  })

  it('is read from the raw code answer', async () => {
    const wasm = Buffer.alloc(15_488, 1).toString('base64')
    expect(await chainCodeSize(true, async () => ({ wasm }))).toEqual({ size: 15_488, unread: false })
  })

  it('a failed read counts as a first deployment and says so', async () => {
    const code = await chainCodeSize(true, async () => Promise.reject(new Error('down')))
    expect(code).toEqual({ size: 0, unread: true })
    const r = deployRam({ sendWasm: true, wasmSize: 17_525, chainCodeSize: code.size, sendAbi: false, abiSize: 0, chainAbiSize: 0 })
    expect(r.needed).toBe(175_250)
    expect(deployRamText({ ramNeeded: r.needed, ramNew: r.newBytes, ramReplaced: r.replacedBytes, ramAvailable: 1_000, chainCodeUnread: code.unread })).toBe(
      `RAM needed about ${n(175_250)} bytes; available ${n(1_000)} bytes. ${CODE_SIZE_UNREAD}`
    )
    expect(CODE_SIZE_UNREAD).toBe('The size of the code now on the account could not be read; counted as a first deployment.')
  })
})
