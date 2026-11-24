// Accepted cases of settings:set for the theme and the remembered dialog sizes,
// and who may call it.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  dataDir: '',
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>(),
  nativeTheme: { shouldUseDarkColors: true, themeSource: 'system', on: () => undefined }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => h.dataDir,
    getAppPath: () => h.dataDir,
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  nativeTheme: h.nativeTheme,
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import { registerIpc } from '../../src/main/ipc'

function event(url: string, mainFrame = true): unknown {
  const frame = { url }
  return { senderFrame: frame, sender: { mainFrame: mainFrame ? frame : {}, send: () => undefined, isDestroyed: () => false } }
}
const editor = event('app://bundle/index.html')

function set(patch: unknown, e: unknown = editor): Promise<unknown> {
  return h.handlers.get('settings:set')!(e, patch)
}

beforeAll(() => {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-settings-'))
  registerIpc(() => null)
})

describe('settings:set theme and dialog sizes', () => {
  it('the theme sets the native theme source', async () => {
    await set({ theme: 'light' })
    expect(h.nativeTheme.themeSource).toBe('light')
    await set({ theme: 'dark' })
    expect(h.nativeTheme.themeSource).toBe('dark')
    await set({ theme: 'system' })
    expect(h.nativeTheme.themeSource).toBe('system')
  })

  it('a dialog size is stored and null forgets it', async () => {
    const stored = (await set({ dialogSizes: { deploy: { width: 900, height: 600 } } })) as { dialogSizes: Record<string, unknown> }
    expect(stored.dialogSizes.deploy).toEqual({ width: 900, height: 600 })
    expect(((await h.handlers.get('settings:get')!(editor)) as typeof stored).dialogSizes.deploy).toEqual({ width: 900, height: 600 })
    const forgotten = (await set({ dialogSizes: { deploy: null } })) as typeof stored
    expect(forgotten.dialogSizes.deploy).toBeUndefined()
  })

  it('is refused from the terminal frame and from the confirmation window', async () => {
    for (const e of [event('app://terminal/index.html'), event('app://bundle/confirm.html'), event('app://bundle/index.html', false)]) {
      await expect(set({ theme: 'light' }, e)).rejects.toThrow('Refused')
      await expect(set({ dialogSizes: { deploy: { width: 900, height: 600 } } }, e)).rejects.toThrow('Refused')
    }
    expect(h.nativeTheme.themeSource).toBe('system')
  })
})
