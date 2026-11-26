import { describe, expect, it } from 'vitest'
import { filesOnDiskLine } from '../../src/renderer/src/lib/auto-build'
import type { BuildStatus } from '../../src/shared/api'

const base: BuildStatus = { builtAt: Date.UTC(2026, 10, 26, 12, 5), result: 'ok', variant: 'testnet', takes: 'testnet', filesMatch: true, changed: false }

describe('Deploy line with automatic build off (E69)', () => {
  it('names the build that is sent and when', () => {
    const l = filesOnDiskLine(base)
    expect(l.fits).toBe(true)
    expect(l.text).toMatch(/^Sends the testnet build from \d\d:\d\d\.$/)
  })
  it('says when the project changed since that build', () => {
    expect(filesOnDiskLine({ ...base, changed: true }).text).toContain('press Rebuild to send the changes')
  })
  it('another network’s build, a failed build, changed files and no build ask for Rebuild', () => {
    expect(filesOnDiskLine({ ...base, takes: 'mainnet' })).toMatchObject({ fits: false })
    expect(filesOnDiskLine({ ...base, takes: 'mainnet' }).text).toContain('this network takes the mainnet build')
    expect(filesOnDiskLine({ ...base, result: 'failed' }).fits).toBe(false)
    expect(filesOnDiskLine({ ...base, filesMatch: false }).fits).toBe(false)
    expect(filesOnDiskLine({ ...base, builtAt: null, variant: null }).fits).toBe(false)
  })
  it('a project without the macros may send files on disk that were not built here', () => {
    expect(filesOnDiskLine({ ...base, builtAt: null, variant: null, takes: 'any' }).fits).toBe(true)
    expect(filesOnDiskLine({ ...base, variant: 'any', takes: 'any', filesMatch: false }).fits).toBe(true)
  })
})
