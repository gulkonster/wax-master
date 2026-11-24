import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '.', getVersion: () => '0.3.0', isPackaged: false } }))
import { compareVersions } from '../../src/main/updates'

describe('version comparison', () => {
  it('orders versions', () => {
    expect(compareVersions('1.0.0', '0.13.0')).toBe(1)
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0-rc1')).toBe(1)
    expect(compareVersions('1.0.0-rc1', '1.0.0-rc2')).toBe(-1)
  })
})
