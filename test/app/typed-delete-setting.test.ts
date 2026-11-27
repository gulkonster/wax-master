// E73: "Ask to type a word before deleting" is on by default, an older settings
// file without it reads it as on, and a malformed value falls back to on.

import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ data: '' }))
h.data = mkdtempSync(join(tmpdir(), 'wm-typed-delete-'))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.data, getAppPath: () => h.data, on: () => undefined }
}))

afterAll(() => rmSync(h.data, { recursive: true, force: true }))

async function freshStore(file: unknown): Promise<typeof import('../../src/main/store')> {
  writeFileSync(join(h.data, 'settings.json'), JSON.stringify(file))
  vi.resetModules()
  return import('../../src/main/store')
}

describe('typedDeleteConfirm setting (E73)', () => {
  it('an older settings file without the value reads it as on', async () => {
    const store = await freshStore({ version: 1, settings: { fontSize: 15, autoBuildOnDeploy: false }, projects: [] })
    expect(store.getSettings().typedDeleteConfirm).toBe(true)
    expect(store.typedDeleteConfirm()).toBe(true)
    expect(store.getSettings().fontSize).toBe(15)
  })
  it('a malformed value falls back to on; a saved off stays off', async () => {
    let store = await freshStore({ version: 1, settings: { typedDeleteConfirm: 'no' } })
    expect(store.typedDeleteConfirm()).toBe(true)
    store.updateSettings({ typedDeleteConfirm: false })
    expect(store.typedDeleteConfirm()).toBe(false)
    vi.resetModules()
    store = await import('../../src/main/store')
    expect(store.typedDeleteConfirm()).toBe(false)
  })
})
