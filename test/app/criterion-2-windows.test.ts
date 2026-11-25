// Release criterion 2 (approval integrity), window part: which web contents may
// call confirm:* and reveal:*, the Approve delay after the window is shown and
// focused, one confirmation at a time, and a locked vault stopping before any
// window.

import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
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
  editorSent: [] as { channel: string; args: unknown[] }[],
  savePath: '',
  /** Runs while the system Save dialog is open (a lock during the dialog). */
  onSave: null as null | (() => void),
  /** The button index of the next native questions (0 = Cancel). */
  answer: 0,
  clip: '',
  appListeners: new Map<string, (() => void)[]>(),
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
  title: string
  emit(ev: string, ...args: unknown[]): void
}

vi.mock('electron', () => {
  class BrowserWindow {
    webContents: FakeWin['webContents']
    url = ''
    visible = false
    focused = false
    destroyed = false
    title: string
    options: FakeWin['options']
    private listeners = new Map<string, ((...a: unknown[]) => void)[]>()
    constructor(options: FakeWin['options']) {
      this.options = options
      this.title = (options as { title?: string }).title ?? ''
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
    setTitle(title: string): void {
      this.title = title
    }
    on(ev: string, fn: (...a: unknown[]) => void): this {
      this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn])
      return this
    }
    once(ev: string, fn: (...a: unknown[]) => void): this {
      return this.on(ev, fn)
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const fn of this.listeners.get(ev) ?? []) fn(...args)
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
      on: (ev: string, fn: () => void) => h.appListeners.set(ev, [...(h.appListeners.get(ev) ?? []), fn])
    },
    ipcMain: { handle: (ch: string, fn: Fn) => h.handlers.set(ch, fn) },
    powerMonitor: { on: () => undefined, getSystemIdleTime: () => 0 },
    // A clipboard stand-in that keeps its text.
    clipboard: {
      writeText: (text: string) => {
        h.clip = text
      },
      readText: () => h.clip,
      clear: () => {
        h.clip = ''
      }
    },
    dialog: {
      showMessageBox: async () => ({ response: h.answer }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => {
        h.onSave?.()
        return h.savePath ? { canceled: false, filePath: h.savePath } : { canceled: true }
      }
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
import { UnlockCancelled, isVaultLocked, retryAfterUnlock, withoutLockedCode } from '../../src/shared/vault-locked'
import { handle } from '../../src/main/ipc'
import { setLogSink } from '../../src/main/log'
import { chain } from '../../src/main/rpc'
import { FILE_EXISTS } from '../../src/main/key-backup'
import { WRONG_CODE, WRONG_PASSWORD } from '../../src/main/vault'
import { APPROVE_UNFOCUSED, approveLabel } from '../../src/renderer/src/confirm/approve-label'

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

/** The editor window as the main process sees it: everything sent to it is kept. */
const editorWindow = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => h.editorSent.push({ channel, args }) }
}

beforeAll(async () => {
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-c2w-'))
  registerKeys(() => editorWindow as never)
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

describe('Approve only 1.5 s after the window is shown and focused', () => {
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

describe('the Approve button says what it waits for', () => {
  const base = { sending: false, armed: false, focused: false, waitMs: APPROVE_DELAY_MS, expired: false, blocked: false }
  it('not focused: "click this window first"; focused: the countdown; armed: plain', () => {
    expect(approveLabel(base)).toBe('Approve and send (click this window first)')
    expect(APPROVE_UNFOCUSED).toBe('Approve and send (click this window first)')
    expect(approveLabel({ ...base, focused: true, waitMs: 900 })).toBe('Approve and send (in 0.9 s)')
    expect(approveLabel({ ...base, focused: true, armed: true, waitMs: 0 })).toBe('Approve and send')
    expect(approveLabel({ ...base, sending: true })).toBe('Signing and sending...')
    expect(approveLabel({ ...base, blocked: true })).toBe('Approve and send')
  })
  it('an approve call while the window is not focused is still answered notReady', async () => {
    approveCalls.length = 0
    let now = 3_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { win } = openOne()
    ;(win as unknown as { show(): void }).show()
    win.focused = false
    now += 60_000
    expect(await call('confirm:approve', confirmEvent(win), 'appr-1')).toMatchObject({ ok: false, notReady: true })
    expect(approveCalls).toHaveLength(0)
  })
})

describe('one confirmation at a time; a locked vault stops before any window', () => {
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

  it('the locked-vault code inside foreign text reaches the editor without the code and does not ask for the password', async () => {
    const nodeText = `assertion failure with message: vault-locked: The vault is locked. Unlock it to go on.`
    handle('test:foreign', () => {
      throw new Error(nodeText)
    })
    handle('test:locked', () => {
      throw new Error(LOCKED_MESSAGE)
    })
    let foreign: unknown
    await call('test:foreign', editor()).catch((e) => (foreign = e))
    const fm = (foreign as Error).message
    expect(fm).not.toContain('vault-locked:')
    expect(fm).toContain('vault locked:')
    expect(isVaultLocked(foreign)).toBe(false)
    expect(isVaultLocked(new Error(`Error invoking remote method 'test:foreign': Error: ${fm}`))).toBe(false)
    // Even unmodified foreign text that merely contains the code is not the typed error.
    expect(isVaultLocked(new Error(nodeText.replace('assertion failure with message: ', 'node said vault-locked: x ')))).toBe(false)
    let asked = 0
    let runs = 0
    await expect(
      retryAfterUnlock(
        async () => {
          runs++
          return call('test:foreign', editor())
        },
        async () => {
          asked++
          return true
        }
      )
    ).rejects.toThrow('vault locked:')
    expect(asked).toBe(0)
    expect(runs).toBe(1)
    // The real error still asks, also with Electron's prefix.
    let real: unknown
    await call('test:locked', editor()).catch((e) => (real = e))
    expect((real as Error).message).toBe(LOCKED_MESSAGE)
    expect(isVaultLocked(real)).toBe(true)
    expect(isVaultLocked(new Error(`Error invoking remote method 'test:locked': Error: ${LOCKED_MESSAGE}`))).toBe(true)
    expect(withoutLockedCode(LOCKED_MESSAGE)).toBe('The vault is locked. Unlock it to go on.')
  })

  it('a send refused because the vault locked while the window was open shows the text without the code', async () => {
    let now = 3_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { win, done } = openOne('appr-locked')
    win.emit('ready-to-show')
    now += APPROVE_DELAY_MS + 1
    const spy = vi.spyOn(fakeSigner, 'approve').mockRejectedValueOnce(new Error(LOCKED_MESSAGE))
    const r = (await call('confirm:approve', confirmEvent(win), 'appr-locked')) as { ok: boolean; error?: string }
    expect(spy).toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('The vault is locked. Unlock it to go on.')
    await expect(done).resolves.toMatchObject({ approved: false, reason: 'error', error: 'The vault is locked. Unlock it to go on.' })
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

describe('recovery code, recovery password and key backup stay out of the editor window and the log', () => {
  const NEW_PW = 'a new password from the recovery path'
  const logLines: string[] = []
  /** Everything the editor window received: return values of its calls and messages sent to it. */
  const editorSaw: unknown[] = []

  async function fromEditor(channel: string, ...args: unknown[]): Promise<unknown> {
    const r = await call(channel, editor(), ...args)
    editorSaw.push(r)
    return r
  }
  const lastWindow = (): FakeWin => h.windows[h.windows.length - 1]
  const winEvent = (w: FakeWin): unknown => frameEvent(w.webContents.id, 'app://bundle/confirm.html')
  function expectHidden(secret: string): void {
    const seen = JSON.stringify([editorSaw, h.editorSent])
    const plain = secret.replace(/-/g, '')
    expect(seen.includes(secret) || seen.includes(plain)).toBe(false)
    expect(logLines.some((l) => l.includes(secret) || l.includes(plain))).toBe(false)
  }

  beforeAll(() => {
    setLogSink((line) => logLines.push(line))
  })

  it('the editor preload exposes no key-window call; the key-window preload exposes no editor call', () => {
    const editorPreload = readFileSync(join(__dirname, '../../src/preload/index.ts'), 'utf8')
    expect(editorPreload).not.toMatch(/'(keywin|reveal|confirm):/)
    const keyPreload = readFileSync(join(__dirname, '../../src/preload/confirm.ts'), 'utf8')
    expect(keyPreload).not.toMatch(/'keys:/)
    // keywin:hidden is only received (the lock message, no data); the others are calls.
    expect([...keyPreload.matchAll(/'(keywin:\w+)'/g)].map((m) => m[1]).sort()).toEqual(
      ['keywin:backupSave', 'keywin:codeCopy', 'keywin:codeDone', 'keywin:codeSave', 'keywin:hidden', 'keywin:load', 'keywin:recover', 'keywin:reset'].sort()
    )
    expect(keyPreload).toMatch(/ipcRenderer\.on\('keywin:hidden', \(\) => cb\(\)\)/)
  })

  it('a new recovery code is shown only in its own window; every other sender is refused', async () => {
    await call('keys:unlock', editor(), PW).catch(() => undefined)
    const status = await fromEditor('keys:newRecoveryCode', PW)
    expect(Object.keys(status as object).sort()).toEqual(['exists', 'keptCopies', 'keys', 'noBackup', 'recovery', 'unlocked'])
    const codeWin = lastWindow()
    expect(codeWin.url).toMatch(/confirm\.html#code$/)
    const { code } = (await call('keywin:load', winEvent(codeWin))) as { code: string }
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/)
    const { win: confirmWin } = openOne('appr-code')
    for (const e of [editor(), editor('confirm.html'), frameEvent(revealWin.webContents.id, 'app://bundle/confirm.html'), confirmEvent(confirmWin)]) {
      for (const ch of ['keywin:load', 'keywin:codeCopy', 'keywin:codeSave', 'keywin:codeDone']) {
        await expect(call(ch, e)).rejects.toThrow('Refused')
      }
    }
    // A sub frame of the code window is refused too.
    await expect(call('keywin:load', frameEvent(codeWin.webContents.id, 'app://bundle/confirm.html', false))).rejects.toThrow('Refused')
    await expect(call('keywin:codeDone', winEvent(codeWin))).resolves.toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(codeWin.destroyed).toBe(true)
    expectHidden(code)
  })

  it('forgot password: the code and the new password go only to the recovery window; each form answers with its own text', async () => {
    await fromEditor('keys:newRecoveryCode', PW)
    const codeWin = lastWindow()
    const { code } = (await call('keywin:load', winEvent(codeWin))) as { code: string }
    await call('keywin:codeDone', winEvent(codeWin))
    await call('keys:lock', editor())

    await fromEditor('keys:forgot')
    const recoverWin = lastWindow()
    expect(recoverWin.url).toMatch(/confirm\.html#recover$/)
    // The editor cannot drive the recovery window.
    for (const ch of ['keywin:recover', 'keywin:reset', 'keywin:load']) {
      await expect(call(ch, editor(), code, NEW_PW, NEW_PW)).rejects.toThrow('Refused')
    }
    await expect(call('keywin:recover', frameEvent(revealWin.webContents.id, 'app://bundle/confirm.html'), code, NEW_PW, NEW_PW)).rejects.toThrow(
      'Refused'
    )
    expect(await call('keywin:load', winEvent(recoverWin))).toMatchObject({ mode: 'recover', recovery: true })
    const wrongCode = await call('keywin:recover', winEvent(recoverWin), 'ABCDE-FGHJK-MNPQR-STVWX-YZ012', NEW_PW, NEW_PW).catch((e) => e.message)
    const wrongPw = await call('keys:unlock', editor(), 'not the password').catch((e) => e.message)
    expect(wrongCode).toBe(WRONG_CODE)
    expect(wrongPw).toBe(WRONG_PASSWORD)
    await expect(call('keywin:recover', winEvent(recoverWin), code, NEW_PW, 'different')).rejects.toThrow(/not the same/)
    expect(vault().isUnlocked()).toBe(false)

    const r = (await call('keywin:recover', winEvent(recoverWin), code.toLowerCase(), NEW_PW, NEW_PW)) as { code: string }
    expect(vault().isUnlocked()).toBe(true)
    // The same window now shows the new code; it is its own (code mode) and refuses recovery calls.
    expect(await call('keywin:load', winEvent(recoverWin))).toEqual({ mode: 'code', code: r.code, hidden: false })
    await expect(call('keywin:recover', winEvent(recoverWin), r.code, NEW_PW, NEW_PW)).rejects.toThrow('Refused')
    await call('keywin:codeDone', winEvent(recoverWin))
    editorSaw.push(await fromEditor('keys:status'))

    expectHidden(code)
    expectHidden(r.code)
    expectHidden(NEW_PW)
    // Every message the editor got is the vault status, nothing else.
    for (const m of h.editorSent) {
      expect(m.channel).toBe('vault-changed')
      expect(Object.keys(m.args[0] as object).sort()).toEqual(['exists', 'keptCopies', 'keys', 'noBackup', 'recovery', 'unlocked'])
    }
    // Back to the suite's password.
    await call('keys:changePassword', editor(), NEW_PW, PW, PW)
  })

  it('a key backup file is written by the main process; the editor learns only "saved"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-backup-'))
    h.savePath = join(dir, 'backup.txt')
    vi.spyOn(chain, 'getAccountsByAuthorizers').mockResolvedValue({ accounts: [{ account_name: 'alice', permission_name: 'active' }] } as never)
    await call('keys:unlock', editor(), PW).catch(() => undefined)
    const entry = (await fromEditor('keys:import', privateKeyToString(generatePrivateKey(), 'wif'), 'backup me')) as { id: string; publicKey: string }
    const priv = await vault().revealPrivateKey(entry.id, PW)

    const outcome = call('keys:backup', editor(), entry.id)
    await new Promise((r) => setTimeout(r, 0))
    const backupWin = lastWindow()
    expect(backupWin.url).toMatch(/confirm\.html#backup$/)
    for (const e of [editor(), frameEvent(revealWin.webContents.id, 'app://bundle/confirm.html')]) {
      await expect(call('keywin:backupSave', e, PW)).rejects.toThrow('Refused')
    }
    expect(existsSync(h.savePath)).toBe(false)
    await expect(call('keywin:backupSave', winEvent(backupWin), 'wrong password')).rejects.toThrow(WRONG_PASSWORD)
    expect(existsSync(h.savePath)).toBe(false)
    expect(await call('keywin:backupSave', winEvent(backupWin), PW)).toBe('saved')
    const text = readFileSync(h.savePath, 'utf8')
    expect(text.startsWith('WAX Master key backup')).toBe(true)
    expect(text.includes(priv)).toBe(true)
    expect(text.includes(entry.publicKey)).toBe(true)
    expect(text.includes('alice@active')).toBe(true)
    expect(text).toContain('Anyone who has this file controls every account that uses this key.')
    // Never over an existing file.
    await expect(call('keywin:backupSave', winEvent(backupWin), PW)).rejects.toThrow(FILE_EXISTS)
    expect(readFileSync(h.savePath, 'utf8')).toBe(text)

    ;(backupWin as unknown as { close(): void }).close()
    const r = await outcome
    editorSaw.push(r)
    expect(r).toBe('saved')
    expect(vault().list().find((k) => k.id === entry.id)!.backup).toBe('file')
    editorSaw.push(await fromEditor('keys:list'))
    expectHidden(priv)
    expect(logLines.filter((l) => l.includes('Key backup file written'))).toHaveLength(1)
    expect(logLines.some((l) => l.includes(dir))).toBe(false)
    h.savePath = ''
  })

  it('the key backup window closed without saving tells the editor "cancelled"', async () => {
    const outcome = call('keys:backup', editor(), keyId)
    await new Promise((r) => setTimeout(r, 0))
    ;(lastWindow() as unknown as { close(): void }).close()
    await expect(outcome).resolves.toBe('cancelled')
  })

  it('reset needs the typed word and keeps the old file; afterwards a new vault starts', async () => {
    await fromEditor('keys:forgot')
    const recoverWin = lastWindow()
    for (const word of ['reset', 'RESET ', '', 'Reset']) {
      await expect(call('keywin:reset', winEvent(recoverWin), word)).rejects.toThrow(/Type RESET/)
      expect(vault().exists()).toBe(true)
    }
    await expect(call('keywin:reset', winEvent(recoverWin), 7)).rejects.toThrow('Refused')
    const { file } = (await call('keywin:reset', winEvent(recoverWin), 'RESET')) as { file: string }
    expect(file).toMatch(/^vault-old-\d{4}-\d{2}-\d{2}(-\d+)?\.json$/)
    expect(readdirSync(h.dataDir)).toContain(file)
    expect(vault().exists()).toBe(false)
    expect(vault().isUnlocked()).toBe(false)
    // The suite's vault again (other suites of this file ran before).
    await call('keys:create', editor(), PW, PW)
  })
})

describe('the recovery code after a lock, a newer code, and the backup window after a lock', () => {
  const lastWindow = (): FakeWin => h.windows[h.windows.length - 1]
  const winEvent = (w: FakeWin): unknown => frameEvent(w.webContents.id, 'app://bundle/confirm.html')
  const lockNow = (): unknown => h.handlers.get('keys:lock')!(editor())

  afterEach(async () => {
    h.onSave = null
    h.savePath = ''
    h.answer = 0
    if (!vault().isUnlocked()) await call('keys:unlock', editor(), PW)
  })

  async function codeWindow(): Promise<{ win: FakeWin; code: string }> {
    await call('keys:newRecoveryCode', editor(), PW)
    const win = lastWindow()
    const { code } = (await call('keywin:load', winEvent(win))) as { code: string }
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/)
    return { win, code }
  }

  it('keys:lock wipes the code: load, copy and save of that window give no code; the window stays and closes without the question', async () => {
    const { win, code } = await codeWindow()
    const before = win.url
    expect(before).toMatch(/confirm\.html#code$/)
    const sentBefore = h.sent.length
    await call('keys:lock', editor())
    expect(win.destroyed).toBe(false)
    // The page is told to drop the code, then loaded again as a new document (a query, not only the hash,
    // differs: a hash-only change keeps the old page and its code) and shows the locked text.
    expect(h.sent.slice(sentBefore).map((m) => m.channel)).toContain('keywin:hidden')
    expect(win.url).toMatch(/confirm\.html\?hidden=\d+#code$/)
    expect(win.url.split('#')[0]).not.toBe(before.split('#')[0])
    const loaded = await call('keywin:load', winEvent(win))
    expect(loaded).toEqual({ mode: 'code', code: '', hidden: true })
    h.clip = ''
    await expect(call('keywin:codeCopy', winEvent(win))).rejects.toThrow('No code')
    expect(h.clip).toBe('')
    const dir = mkdtempSync(join(tmpdir(), 'wm-code-'))
    h.savePath = join(dir, 'code.txt')
    await expect(call('keywin:codeSave', winEvent(win))).rejects.toThrow('No code')
    expect(existsSync(h.savePath)).toBe(false)
    expect(JSON.stringify(loaded)).not.toContain(code)
    // Closing asks nothing (the question would need the close event to be stopped).
    expect(() => win.emit('close')).not.toThrow()
  })

  it('each lock reloads the code window as a new document; the page drops its copy of the code on the message', async () => {
    const first = await codeWindow()
    await call('keys:lock', editor())
    const firstUrl = first.win.url
    await call('keys:unlock', editor(), PW)
    const second = await codeWindow()
    await call('keys:lock', editor())
    // Two locks, two different addresses: a reload is never a hash-only (same document) navigation.
    expect(second.win.url).toMatch(/confirm\.html\?hidden=\d+#code$/)
    expect(second.win.url).not.toBe(firstUrl)
    // A window whose code is already hidden is not loaded again and gets no code.
    const again = second.win.url
    await call('keys:lock', editor())
    expect(second.win.url).toBe(again)
    expect(await call('keywin:load', winEvent(second.win))).toEqual({ mode: 'code', code: '', hidden: true })
    // The preload hands the lock message to the page, and the code page clears its state on it.
    const preload = readFileSync(join(__dirname, '../../src/preload/confirm.ts'), 'utf8')
    expect(preload).toMatch(/onCodeHidden[\s\S]*ipcRenderer\.on\('keywin:hidden'/)
    const page = readFileSync(join(__dirname, '../../src/renderer/src/confirm/main.tsx'), 'utf8')
    const code = page.slice(page.indexOf('function Code('), page.indexOf('function Recover('))
    expect(code).toMatch(/onCodeHidden\(\(\) => \{[\s\S]*setCode\(''\)[\s\S]*setVisible\(false\)[\s\S]*setHidden\(true\)/)
  })

  it('the vault locking by itself hides the code too, also a code made while the vault was locked', async () => {
    const first = await codeWindow()
    vault().lock()
    expect(await call('keywin:load', winEvent(first.win))).toEqual({ mode: 'code', code: '', hidden: true })
    // New recovery code works with the password on a locked vault; Lock hides it again.
    const second = await codeWindow()
    expect(vault().isUnlocked()).toBe(false)
    await call('keys:lock', editor())
    expect(await call('keywin:load', winEvent(second.win))).toEqual({ mode: 'code', code: '', hidden: true })
  })

  it('a second keys:newRecoveryCode closes the first code window; Remove recovery code closes the second', async () => {
    const first = await codeWindow()
    const second = await codeWindow()
    expect(first.win.destroyed).toBe(true)
    expect(second.win.destroyed).toBe(false)
    await expect(call('keywin:load', winEvent(first.win))).rejects.toThrow('Refused')
    h.answer = 1
    await call('keys:removeRecoveryCode', editor(), PW)
    expect(second.win.destroyed).toBe(true)
    // Back to a vault with a code for the next cases.
    await call('keys:newRecoveryCode', editor(), PW)
    ;(lastWindow() as unknown as { close(): void }).close()
  })

  it('a recovery with the code closes older code windows and keeps its own; the forgot-password window stays open on a lock', async () => {
    const older = await codeWindow()
    const current = await call('keys:newRecoveryCode', editor(), PW).then(async () => {
      const w = lastWindow()
      return { win: w, ...((await call('keywin:load', winEvent(w))) as { code: string }) }
    })
    expect(older.win.destroyed).toBe(true)
    await call('keys:lock', editor())
    await call('keys:forgot', editor())
    const recoverWin = lastWindow()
    expect(recoverWin.title).toBe('Forgot password')
    // A code window that is still open (its code hidden by the lock) closes after the recovery.
    expect(current.win.destroyed).toBe(false)
    vault().lock()
    await call('keys:lock', editor())
    expect(recoverWin.destroyed).toBe(false)
    const r = (await call('keywin:recover', winEvent(recoverWin), current.code, PW, PW)) as { code: string }
    expect(current.win.destroyed).toBe(true)
    expect(recoverWin.destroyed).toBe(false)
    expect(recoverWin.title).toBe('Vault recovery code')
    expect(await call('keywin:load', winEvent(recoverWin))).toEqual({ mode: 'code', code: r.code, hidden: false })
    const recoverUrl = recoverWin.url
    await call('keys:lock', editor())
    expect(recoverWin.url).toMatch(/confirm\.html\?hidden=\d+#code$/)
    expect(recoverWin.url.split('#')[0]).not.toBe(recoverUrl.split('#')[0])
    expect(await call('keywin:load', winEvent(recoverWin))).toEqual({ mode: 'code', code: '', hidden: true })
  })

  it('the code window locked while the Save dialog was open writes nothing', async () => {
    const { win } = await codeWindow()
    const dir = mkdtempSync(join(tmpdir(), 'wm-code-'))
    h.savePath = join(dir, 'code.txt')
    h.onSave = () => void lockNow()
    expect(await call('keywin:codeSave', winEvent(win))).toBe('cancelled')
    expect(existsSync(h.savePath)).toBe(false)
  })

  it('the backup window closed by a lock while the Save dialog was open writes no file and keeps the note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-backup-lock-'))
    h.savePath = join(dir, 'backup.txt')
    const entry = (await call('keys:import', editor(), privateKeyToString(generatePrivateKey(), 'wif'), 'lock during dialog')) as { id: string }
    vault().setBackup(entry.id, 'none')
    const outcome = call('keys:backup', editor(), entry.id)
    await new Promise((r) => setTimeout(r, 0))
    const backupWin = lastWindow()
    h.onSave = () => void lockNow()
    expect(await call('keywin:backupSave', winEvent(backupWin), PW)).toBe('cancelled')
    expect(backupWin.destroyed).toBe(true)
    expect(existsSync(h.savePath)).toBe(false)
    await expect(outcome).resolves.toBe('cancelled')
    expect(vault().list().find((k) => k.id === entry.id)!.backup).toBe('none')
  })

  it('account names from the node: only valid chain names reach the file, at most 200', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-backup-names-'))
    h.savePath = join(dir, 'backup.txt')
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      account_name: `n${i.toString(5).replace(/[0-4]/g, (d) => String(Number(d) + 1))}`,
      permission_name: 'active'
    }))
    vi.spyOn(chain, 'getAccountsByAuthorizers').mockResolvedValue({
      accounts: [
        { account_name: 'alice\nPrivate key: PVT_K1_fake', permission_name: 'active' },
        { account_name: 'bob', permission_name: 'active\r\nInjected line' },
        { account_name: 7, permission_name: 'active' },
        ...many
      ]
    } as never)
    const entry = (await call('keys:import', editor(), privateKeyToString(generatePrivateKey(), 'wif'), 'names')) as { id: string }
    const outcome = call('keys:backup', editor(), entry.id)
    await new Promise((r) => setTimeout(r, 0))
    const backupWin = lastWindow()
    expect(await call('keywin:backupSave', winEvent(backupWin), PW)).toBe('saved')
    const lines = readFileSync(h.savePath, 'utf8').split('\r\n')
    expect(lines.some((l) => l.includes('alice') || l.includes('Injected') || l.includes('PVT_K1_fake'))).toBe(false)
    const accountLines = lines.filter((l) => /^ {2}n[1-5]+@active$/.test(l))
    expect(accountLines).toHaveLength(200)
    ;(backupWin as unknown as { close(): void }).close()
    await outcome
  })

  it('"shown" is written only over "none"', async () => {
    const entry = (await call('keys:import', editor(), privateKeyToString(generatePrivateKey(), 'wif'), 'shown')) as { id: string }
    await call('keys:reveal', editor(), entry.id)
    const win = lastWindow()
    vault().setBackup(entry.id, 'file')
    await call('reveal:show', winEvent(win), PW)
    await call('reveal:copy', winEvent(win), PW)
    expect(vault().list().find((k) => k.id === entry.id)!.backup).toBe('file')
    vault().setBackup(entry.id, 'none')
    await call('reveal:show', winEvent(win), PW)
    expect(vault().list().find((k) => k.id === entry.id)!.backup).toBe('shown')
    await expect(call('reveal:show', winEvent(win), 'not the password')).rejects.toThrow(WRONG_PASSWORD)
  })

  it('every key window keeps its own title, not the page title', async () => {
    const { id } = (await call('keys:import', editor(), privateKeyToString(generatePrivateKey(), 'wif'), 'titles')) as { id: string }
    await call('keys:reveal', editor(), id)
    const reveal = lastWindow()
    const backup = call('keys:backup', editor(), id)
    await new Promise((r) => setTimeout(r, 0))
    const backupWin = lastWindow()
    const { win: codeWin } = await codeWindow()
    await call('keys:forgot', editor())
    const recoverWin = lastWindow()
    const titles = [reveal, backupWin, codeWin, recoverWin].map((w) => w.title)
    expect(titles).toEqual(['Show private key', 'Back up key', 'Vault recovery code', 'Forgot password'])
    for (const w of [reveal, backupWin, codeWin, recoverWin]) {
      let stopped = false
      w.emit('page-title-updated', { preventDefault: () => (stopped = true) }, 'Confirm transaction')
      expect(stopped).toBe(true)
    }
    ;(backupWin as unknown as { close(): void }).close()
    await backup
  })

  it('quit clears the clipboard when it still holds the copied code or key, and leaves other text alone', async () => {
    const quit = (): void => {
      for (const fn of h.appListeners.get('before-quit') ?? []) fn()
    }
    const { win, code } = await codeWindow()
    await call('keywin:codeCopy', winEvent(win))
    expect(h.clip).toBe(code)
    quit()
    expect(h.clip).toBe('')
    await call('keys:unlock', editor(), PW)

    const { id } = (await call('keys:import', editor(), privateKeyToString(generatePrivateKey(), 'wif'), 'clipboard')) as { id: string }
    await call('keys:reveal', editor(), id)
    await call('reveal:copy', winEvent(lastWindow()), PW)
    expect(h.clip.startsWith('PVT_K1_')).toBe(true)
    h.clip = 'something the user copied later'
    quit()
    expect(h.clip).toBe('something the user copied later')
  })
})
