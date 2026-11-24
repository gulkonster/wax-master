// Release criterion 2 (approval integrity), window part: which web contents may
// call confirm:* and reveal:*, the Approve delay after the window is shown and
// focused, one confirmation at a time, and a locked vault stopping before any
// window.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>

const h = vi.hoisted(() => ({
  dataDir: '',
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>(),
  windows: [] as FakeWin[],
  sent: [] as { channel: string; args: unknown[] }[],
  frameSent: [] as { channel: string; args: unknown[] }[],
  dark: true,
  nextId: 100
}))

interface FakeWin {
  webContents: { id: number; send: (ch: string, ...a: unknown[]) => void; on: () => void }
  options: { minWidth?: number; minHeight?: number; backgroundColor?: string; webPreferences: { preload: string; additionalArguments: string[] } }
  url: string
  visible: boolean
  focused: boolean
  destroyed: boolean
  emit(ev: string): void
}

vi.mock('electron', () => {
  class BrowserWindow {
    webContents: FakeWin['webContents']
    url = ''
    visible = false
    focused = false
    destroyed = false
    options: FakeWin['options']
    private listeners = new Map<string, (() => void)[]>()
    constructor(options: FakeWin['options']) {
      this.options = options
      this.webContents = {
        id: h.nextId++,
        send: (channel: string, ...args: unknown[]) => h.sent.push({ channel, args }),
        on: () => undefined,
        mainFrame: { framesInSubtree: [{ send: (channel: string, ...args: unknown[]) => h.frameSent.push({ channel, args }) }] }
      } as unknown as FakeWin['webContents']
      h.windows.push(this as unknown as FakeWin)
    }
    setMenu(): void {}
    setBackgroundColor(): void {}
    on(ev: string, fn: () => void): this {
      this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn])
      return this
    }
    once(ev: string, fn: () => void): this {
      return this.on(ev, fn)
    }
    emit(ev: string): void {
      for (const fn of this.listeners.get(ev) ?? []) fn()
    }
    loadURL(url: string): Promise<void> {
      this.url = url
      return Promise.resolve()
    }
    show(): void {
      this.visible = true
      this.emit('show')
    }
    focus(): void {
      this.focused = true
      this.emit('focus')
    }
    isVisible(): boolean {
      return this.visible
    }
    isFocused(): boolean {
      return this.focused
    }
    isMinimized(): boolean {
      return false
    }
    restore(): void {}
    isDestroyed(): boolean {
      return this.destroyed
    }
    close(): void {
      if (this.destroyed) return
      this.destroyed = true
      this.emit('closed')
    }
    destroy(): void {
      this.close()
    }
  }
  return {
    app: {
      isPackaged: false,
      getPath: () => h.dataDir,
      getAppPath: () => h.dataDir,
      getVersion: () => '0.0.0',
      on: () => undefined
    },
    ipcMain: { handle: (ch: string, fn: Fn) => h.handlers.set(ch, fn) },
    powerMonitor: { on: () => undefined, getSystemIdleTime: () => 0 },
    clipboard: { writeText: () => undefined, readText: () => '', clear: () => undefined },
    dialog: {
      showMessageBox: async () => ({ response: 0 }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true })
    },
    shell: {},
    protocol: {},
    session: {},
    net: {},
    // Windows follow the theme (src/main/theme.ts) and open on the screen's work area.
    nativeTheme: {
      get shouldUseDarkColors() {
        return h.dark
      },
      themeSource: 'system',
      on: () => undefined
    },
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ workAreaSize: { width: 1920, height: 1080 } })
    },
    utilityProcess: {},
    BrowserWindow
  }
})

import { generatePrivateKey, privateKeyToString } from '../../src/chain-core'
import { APPROVE_DELAY_MS, hasOpenConfirmation, openConfirmation, registerConfirmWindow } from '../../src/main/confirm-window'
import { registerKeys, vault } from '../../src/main/keys-service'
import { preflight } from '../../src/main/ipc-tx'
import { applyThemeSetting } from '../../src/main/theme'
import { WINDOW_COLORS } from '../../src/shared/theme'
import { BUSY_MESSAGE, LOCKED_MESSAGE, type ApprovalRecord, type Signer } from '../../src/main/signer'
import { UnlockCancelled, isVaultLocked, retryAfterUnlock } from '../../src/shared/vault-locked'

const PW = 'correct horse battery staple'
const EDITOR_ID = 1

function frameEvent(senderId: number, url: string, mainFrame = true): unknown {
  const frame = { url }
  return { senderFrame: frame, sender: { id: senderId, mainFrame: mainFrame ? frame : {}, send: () => undefined, isDestroyed: () => false } }
}
const editor = (path = 'index.html'): unknown => frameEvent(EDITOR_ID, `app://bundle/${path}`)

function call(channel: string, e: unknown, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return Promise.resolve().then(() => fn(e, ...args))
}

function record(id = 'appr-1'): ApprovalRecord {
  return {
    id,
    title: 'Run eosio.token::transfer',
    network: { id: 'wax-testnet', name: 'WAX Testnet', kind: 'testnet', chainId: 'f1'.repeat(32) },
    endpoint: 'https://node-a.example',
    expiresAt: Date.now() + 100_000,
    expiration: '2026-01-01T00:00:00',
    transactionId: 'ab'.repeat(32),
    packedSha256: 'cd'.repeat(32),
    actions: [],
    signers: []
  }
}

const approveCalls: string[] = []
const fakeSigner = {
  approve: async (id: string) => {
    approveCalls.push(id)
    return { transactionId: 'ab'.repeat(32), response: {} }
  },
  cancel: () => undefined
} as unknown as Signer

let revealWin: FakeWin
let keyId: string

beforeAll(async () => {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-c2w-'))
  registerKeys(() => null)
  // The window handlers below use a stand-in signer (approval content is tested in criterion-2-signer).
  registerConfirmWindow(fakeSigner)
  await call('keys:create', editor(), PW, PW)
  const entry = (await call('keys:import', editor(), privateKeyToString(generatePrivateKey(), 'wif'), 'test')) as { id: string }
  keyId = entry.id
  await call('keys:reveal', editor(), keyId)
  revealWin = h.windows[h.windows.length - 1]
}, 30_000)

afterEach(() => {
  vi.restoreAllMocks()
  for (const w of h.windows) if (w !== revealWin && !w.destroyed) (w as unknown as { close(): void }).close()
})

function openOne(id = 'appr-1'): { win: FakeWin; done: Promise<unknown> } {
  const done = openConfirmation(null, record(id), Buffer.alloc(32, 1))
  const win = h.windows[h.windows.length - 1]
  return { win, done }
}

const confirmEvent = (w: FakeWin): unknown => frameEvent(w.webContents.id, 'app://bundle/confirm.html')

describe('confirm:* only from the confirmation window', () => {
  it('confirm:load, confirm:approve and confirm:cancel are refused from the editor window', async () => {
    const { win } = openOne()
    for (const e of [editor(), editor('confirm.html')]) {
      await expect(call('confirm:load', e)).rejects.toThrow('Refused')
      await expect(call('confirm:approve', e, 'appr-1')).rejects.toThrow('Refused')
      await expect(call('confirm:cancel', e, 'appr-1')).rejects.toThrow('Refused')
    }
    // The real window can still load it: nothing was used up.
    await expect(call('confirm:load', confirmEvent(win))).resolves.toMatchObject({ id: 'appr-1' })
  })

  it('confirm:load, confirm:approve and confirm:cancel are refused from a reveal window', async () => {
    openOne()
    const e = frameEvent(revealWin.webContents.id, 'app://bundle/confirm.html')
    await expect(call('confirm:load', e)).rejects.toThrow('Refused')
    await expect(call('confirm:approve', e, 'appr-1')).rejects.toThrow('Refused')
    await expect(call('confirm:cancel', e, 'appr-1')).rejects.toThrow('Refused')
    expect(approveCalls).toHaveLength(0)
  })

  it('a sub frame of the confirmation window is refused', async () => {
    const { win } = openOne()
    await expect(call('confirm:load', frameEvent(win.webContents.id, 'app://bundle/confirm.html', false))).rejects.toThrow('Refused')
  })
})

describe('reveal:* only from the reveal window', () => {
  it('reveal:load, reveal:show and reveal:copy are refused from the editor window', async () => {
    for (const e of [editor(), editor('confirm.html')]) {
      await expect(call('reveal:load', e)).rejects.toThrow('Refused')
      await expect(call('reveal:show', e, PW)).rejects.toThrow('Refused')
      await expect(call('reveal:copy', e, PW)).rejects.toThrow('Refused')
    }
  })

  it('reveal:load, reveal:show and reveal:copy are refused from a confirmation window', async () => {
    const { win } = openOne()
    const e = confirmEvent(win)
    await expect(call('reveal:load', e)).rejects.toThrow('Refused')
    await expect(call('reveal:show', e, PW)).rejects.toThrow('Refused')
    await expect(call('reveal:copy', e, PW)).rejects.toThrow('Refused')
  })

  it('the reveal window itself may load its key', async () => {
    await expect(call('reveal:load', frameEvent(revealWin.webContents.id, 'app://bundle/confirm.html'))).resolves.toMatchObject({ label: 'test' })
  })
})

describe('task 5a: Approve only 1.5 s after the window is shown and focused', () => {
  it('a click right after the window appears is refused and uses up nothing', async () => {
    approveCalls.length = 0
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { win } = openOne()
    win.emit('ready-to-show')
    const r1 = (await call('confirm:approve', confirmEvent(win), 'appr-1')) as { ok: boolean; notReady?: boolean }
    expect(r1).toMatchObject({ ok: false, notReady: true })
    now += APPROVE_DELAY_MS - 100
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ notReady: true })
    expect(approveCalls).toHaveLength(0)
    now += 200
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ ok: true })
    expect(approveCalls).toEqual(['appr-1'])
  })

  it('losing focus starts the wait again; a shown but unfocused window cannot approve', async () => {
    approveCalls.length = 0
    let now = 2_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { win } = openOne()
    // Shown without focus (for example behind another window).
    ;(win as unknown as { show(): void }).show()
    now += 5000
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ notReady: true })
    ;(win as unknown as { focus(): void }).focus()
    now += APPROVE_DELAY_MS + 1
    win.focused = false
    win.emit('blur')
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ notReady: true })
    ;(win as unknown as { focus(): void }).focus()
    now += 500
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ notReady: true })
    now += APPROVE_DELAY_MS
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ ok: true })
    expect(approveCalls).toHaveLength(1)
  })
})

describe('task 5b and 5c: one confirmation at a time; a locked vault stops before any window', () => {
  it('a second request while a confirmation is open is refused before any window', async () => {
    const { win } = openOne()
    expect(hasOpenConfirmation()).toBe(true)
    const before = h.windows.length
    expect(() => preflight(null)).toThrow(BUSY_MESSAGE)
    expect(h.windows.length).toBe(before)
    ;(win as unknown as { close(): void }).close()
    expect(hasOpenConfirmation()).toBe(false)
    expect(() => preflight(null)).not.toThrow()
  })

  it('locked vault: one typed vault-locked error, the editor is not sent to another dialog, no window', async () => {
    vault().lock()
    h.sent.length = 0
    const before = h.windows.length
    const editorWin = { isDestroyed: () => false, webContents: { send: (channel: string, ...args: unknown[]) => h.sent.push({ channel, args }) } }
    expect(() => preflight(editorWin as never)).toThrow(LOCKED_MESSAGE)
    let err: unknown
    try {
      preflight(editorWin as never)
    } catch (e) {
      err = e
    }
    expect(isVaultLocked(err)).toBe(true)
    // Electron prefixes the message on its way to the editor; it is still recognized there.
    expect(isVaultLocked(new Error(`Error invoking remote method 'tx:run': Error: ${LOCKED_MESSAGE}`))).toBe(true)
    expect(h.sent).toEqual([])
    expect(h.windows.length).toBe(before)
    await call('keys:unlock', editor(), PW)
  })

  it('unlock then continue: the request stops before any window, the password is asked in place, the request runs once more and opens one window', async () => {
    vault().lock()
    const before = h.windows.length
    let runs = 0
    let asked = 0
    const request = async (): Promise<{ done: Promise<unknown> }> => {
      runs++
      preflight(null)
      return { done: openConfirmation(null, record('appr-retry'), Buffer.alloc(32, 1)) }
    }
    const r = await retryAfterUnlock(request, async () => {
      asked++
      // While the prompt is open no confirmation window exists.
      expect(h.windows.length).toBe(before)
      expect(hasOpenConfirmation()).toBe(false)
      await call('keys:unlock', editor(), PW)
      return true
    })
    expect(asked).toBe(1)
    expect(runs).toBe(2)
    expect(h.windows.length).toBe(before + 1)
    expect(hasOpenConfirmation()).toBe(true)
    ;(h.windows[h.windows.length - 1] as unknown as { close(): void }).close()
    await expect(r.done).resolves.toMatchObject({ approved: false })
  })

  it('unlock cancelled: the request ends quietly, nothing opens, the vault stays locked', async () => {
    vault().lock()
    const before = h.windows.length
    let runs = 0
    const request = async (): Promise<void> => {
      runs++
      preflight(null)
      await openConfirmation(null, record('appr-cancel'), Buffer.alloc(32, 1))
    }
    await expect(retryAfterUnlock(request, async () => false)).rejects.toBeInstanceOf(UnlockCancelled)
    expect(runs).toBe(1)
    expect(h.windows.length).toBe(before)
    expect(vault().isUnlocked()).toBe(false)
    // Another error than the locked vault is not answered with the prompt.
    let asked = 0
    await expect(
      retryAfterUnlock(
        async () => {
          throw new Error(BUSY_MESSAGE)
        },
        async () => {
          asked++
          return true
        }
      )
    ).rejects.toThrow(BUSY_MESSAGE)
    expect(asked).toBe(0)
    await call('keys:unlock', editor(), PW)
  })
})

describe('locking the vault closes an open confirmation window', () => {
  it('keys:lock closes the window, ends the request as closed and frees the next one', async () => {
    await call('keys:unlock', editor(), PW).catch(() => undefined)
    const { win, done } = openOne('appr-lock')
    expect(hasOpenConfirmation()).toBe(true)
    await call('keys:lock', editor())
    expect(win.destroyed).toBe(true)
    await expect(done).resolves.toEqual({ approved: false, reason: 'closed' })
    expect(hasOpenConfirmation()).toBe(false)
    // An approve that arrives afterwards is refused: the window is no longer known.
    await expect(call('confirm:approve', confirmEvent(win), 'appr-lock')).rejects.toThrow('Refused')
    await call('keys:unlock', editor(), PW)
  })

  it('the vault locking by itself (not only keys:lock) does the same', async () => {
    const { win, done } = openOne('appr-lock2')
    vault().lock()
    expect(win.destroyed).toBe(true)
    await expect(done).resolves.toMatchObject({ approved: false, reason: 'closed' })
    await call('keys:unlock', editor(), PW)
  })
})

describe('the confirmation and reveal windows follow the theme', () => {
  const saved = process.env.ELECTRON_RENDERER_URL
  afterEach(() => {
    h.dark = true
    if (saved === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = saved
  })

  it('each is created with exactly one page argument, the resolved theme', async () => {
    delete process.env.ELECTRON_RENDERER_URL
    for (const dark of [true, false]) {
      h.dark = dark
      const { win } = openOne(`appr-theme-${dark}`)
      expect(win.options.webPreferences.additionalArguments).toEqual([`--wax-theme=${dark ? 'dark' : 'light'}`])
      expect(win.options.backgroundColor).toBe(WINDOW_COLORS[dark ? 'dark' : 'light'].content)
      await call('keys:reveal', editor(), keyId)
      const reveal = h.windows[h.windows.length - 1]
      expect(reveal.options.webPreferences.additionalArguments).toEqual([`--wax-theme=${dark ? 'dark' : 'light'}`])
      expect(reveal.options.backgroundColor).toBe(WINDOW_COLORS[dark ? 'dark' : 'light'].content)
      ;(reveal as unknown as { close(): void }).close()
      ;(win as unknown as { close(): void }).close()
    }
  })

  it('the reveal window has the minimum size 640 x 360 and the same preload as the confirmation window', async () => {
    const { win } = openOne('appr-size')
    await call('keys:reveal', editor(), keyId)
    const reveal = h.windows[h.windows.length - 1]
    expect(reveal.options.minWidth).toBe(640)
    expect(reveal.options.minHeight).toBe(360)
    expect(reveal.options.webPreferences.preload).toBe(win.options.webPreferences.preload)
    ;(reveal as unknown as { close(): void }).close()
  })

  it('the only message sent to the pages of a window is theme with dark or light', () => {
    const { win } = openOne('appr-msg')
    h.frameSent.length = 0
    for (const dark of [false, true]) {
      h.dark = dark
      applyThemeSetting(dark ? 'dark' : 'light')
    }
    expect(h.frameSent).toEqual([
      { channel: 'theme', args: ['light'] },
      { channel: 'theme', args: ['dark'] }
    ])
    void win
  })
})
