// Handlers of the vault, Clear All App Data, update check and toolchain manager:
// sender checks, malformed input, native confirmations (mocked), lock triggers.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>
  return {
    dataDir: '',
    handlers: new Map<string, Fn>(),
    power: new Map<string, () => void>(),
    appEvents: new Map<string, () => void>(),
    idle: 0,
    answers: [] as number[],
    dialogCalls: [] as { message: string; detail: string }[],
    windows: [] as { id: number; closed: boolean }[],
    exit: vi.fn(),
    relaunch: vi.fn(),
    removed: [] as string[]
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => h.dataDir,
    getAppPath: () => h.dataDir,
    getVersion: () => '0.0.0',
    on: (ev: string, fn: () => void) => h.appEvents.set(ev, fn),
    exit: h.exit,
    relaunch: h.relaunch
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  powerMonitor: {
    on: (ev: string, fn: () => void) => h.power.set(ev, fn),
    getSystemIdleTime: () => h.idle
  },
  clipboard: { writeText: () => undefined, readText: () => '', clear: () => undefined },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      const opts = args[args.length - 1] as { message: string; detail: string; defaultId: number; buttons: string[] }
      h.dialogCalls.push({ message: opts.message, detail: opts.detail })
      // Default Cancel: the default button is the first one, and it is "Cancel".
      expect(opts.buttons[opts.defaultId]).toBe('Cancel')
      return { response: h.answers.shift() ?? 0 }
    },
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true })
  },
  shell: {},
  protocol: {},
  session: {},
  net: {},
  // Windows follow the theme (src/main/theme.ts) and open on the screen's work area.
  nativeTheme: { shouldUseDarkColors: true, themeSource: 'system', on: () => undefined },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workAreaSize: { width: 1920, height: 1080 } })
  },
  utilityProcess: {},
  BrowserWindow: class {
    webContents: { id: number; on: () => void }
    private rec: { id: number; closed: boolean }
    constructor() {
      this.rec = { id: 900 + h.windows.length, closed: false }
      this.webContents = { id: this.rec.id, on: () => undefined }
      h.windows.push(this.rec)
    }
    setMenu(): void {}
    on(): void {}
    once(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
    isDestroyed(): boolean {
      return this.rec.closed
    }
    close(): void {
      this.rec.closed = true
    }
  }
}))

vi.mock('../../src/main/toolchain', () => ({
  DEFAULT_TOOLCHAIN: 'default-tc',
  TOOLCHAINS: [{ id: 'default-tc', label: 'Default' }],
  installedToolchains: () => [{ id: 'default-tc' }, { id: 'extra-tc' }],
  remove: async (id: string) => {
    h.removed.push(id)
  },
  install: async () => ({}),
  testBuild: async () => ({}),
  inspectCdtPackage: async () => ({}),
  status: async () => ({})
}))
vi.mock('../../src/main/updates', () => ({
  checkForUpdates: async () => ({ ok: true }),
  dailyCheck: async () => undefined
}))

import { registerKeys } from '../../src/main/keys-service'
import { registerAppIpc } from '../../src/main/ipc-app'
import { registerToolchainIpc } from '../../src/main/ipc-toolchains'
import { registerIpc } from '../../src/main/ipc'
import { vault } from '../../src/main/keys-service'
import { generatePrivateKey, privateKeyToString } from '../../src/chain-core'

function event(url: string, opts: { id?: number; mainFrame?: boolean } = {}): unknown {
  const frame = { url }
  return {
    senderFrame: frame,
    sender: { id: opts.id ?? 1, mainFrame: opts.mainFrame === false ? {} : frame, send: () => undefined, isDestroyed: () => false }
  }
}
const good = event('app://bundle/index.html')
const PW = 'correct horse battery'

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn(good, ...args)
}

function newKeyText(): string {
  return privateKeyToString(generatePrivateKey(), 'wif')
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] })
  h.dataDir = mkdtempSync(join(tmpdir(), 'wm-keys-ipc-'))
  const getWindow = (): null => null
  registerIpc(getWindow)
  registerKeys(getWindow)
  registerAppIpc(getWindow)
  registerToolchainIpc(getWindow)
  await call('keys:create', PW, PW)
})

beforeEach(() => {
  h.answers.length = 0
  h.dialogCalls.length = 0
  h.removed.length = 0
  h.exit.mockClear()
  h.relaunch.mockClear()
})

describe('sender checks', () => {
  const channels = [
    'keys:status', 'keys:list', 'keys:lock', 'keys:backup', 'keys:forgot', 'keys:changePassword', 'keys:newRecoveryCode',
    'keys:removeRecoveryCode', 'app:checkUpdates', 'toolchains:list'
  ]
  for (const ch of channels) {
    it(`${ch} refuses a foreign origin, the confirmation page and a sub frame`, async () => {
      const fn = h.handlers.get(ch)!
      await expect(fn(event('https://example.com/index.html'))).rejects.toThrow('Refused')
      await expect(fn(event('app://bundle/confirm.html'))).rejects.toThrow('Refused')
      await expect(fn(event('app://bundle/index.html', { mainFrame: false }))).rejects.toThrow('Refused')
    })
  }
  it('app:clearData and keys:remove are refused from the confirmation page', async () => {
    await expect(h.handlers.get('app:clearData')!(event('app://bundle/confirm.html'), false, '')).rejects.toThrow('Refused')
    await expect(h.handlers.get('keys:remove')!(event('app://bundle/confirm.html'), 'x')).rejects.toThrow('Refused')
    expect(h.dialogCalls).toHaveLength(0)
  })
})

describe('malformed input', () => {
  const cases: [string, unknown[]][] = [
    ['keys:create', [1, 2]],
    ['keys:create', ['a'.repeat(2000), 'a'.repeat(2000)]],
    ['keys:create', ['password-one-x', 'password-two-x']],
    ['keys:unlock', [{}]],
    ['keys:unlock', ['x'.repeat(2000)]],
    ['keys:savePending', [5]],
    ['keys:import', [1, 'label']],
    ['keys:import', ['key', 7]],
    ['keys:setLabel', [5, 'x']],
    ['keys:setLabel', ['id', 'x'.repeat(100)]],
    ['keys:remove', [5]],
    ['keys:remove', [null]],
    ['keys:remove', ['no-such-key']],
    ['keys:reveal', [{}]],
    ['keys:reveal', ['no-such-key']],
    ['keys:accounts', ['text']],
    ['keys:accounts', [[1, 2]]],
    ['keys:importVault', [42]],
    ['keys:create', ['abcde', 'abcde']],
    ['keys:backup', [5]],
    ['keys:backup', ['no-such-key']],
    ['keys:changePassword', [1, 2, 3]],
    ['keys:changePassword', [PW, 'new password one', 'new password two']],
    ['keys:changePassword', [PW, 'abcde', 'abcde']],
    ['keys:changePassword', ['wrong password!', 'new password one', 'new password one']],
    ['keys:changePassword', [PW, 'x'.repeat(2000), 'x'.repeat(2000)]],
    ['keys:newRecoveryCode', [{}]],
    ['keys:newRecoveryCode', ['wrong password!']],
    ['keys:removeRecoveryCode', [5]],
    ['keys:removeRecoveryCode', ['wrong password!']],
    ['app:clearData', ['yes']],
    ['app:clearData', [true, 'wrong words']],
    ['app:clearData', [true, 5]],
    ['toolchains:add', [5, 1]],
    ['toolchains:add', ['unknown-token', 1]],
    ['toolchains:remove', [5]],
    ['toolchains:remove', ['x'.repeat(200)]],
    ['toolchains:remove', ['default-tc']]
  ]
  for (const [channel, args] of cases) {
    it(`${channel} refuses ${JSON.stringify(args).slice(0, 60)}`, async () => {
      await expect(call(channel, ...args)).rejects.toThrow()
      expect(h.dialogCalls).toHaveLength(0)
    })
  }
})

describe('keys:remove asks in the main process', () => {
  it('Cancel removes nothing; the dialog shows label and public key', async () => {
    await call('keys:unlock', PW)
    const entry = (await call('keys:import', newKeyText(), 'my label')) as { id: string; publicKey: string }
    h.answers.push(0)
    await call('keys:remove', entry.id)
    expect(vault().list().some((k) => k.id === entry.id)).toBe(true)
    expect(h.dialogCalls).toHaveLength(1)
    expect(h.dialogCalls[0].detail).toContain('my label')
    expect(h.dialogCalls[0].detail).toContain(entry.publicKey)
    h.answers.push(1)
    await call('keys:remove', entry.id)
    expect(vault().list().some((k) => k.id === entry.id)).toBe(false)
  })
  it('asks also while the vault is locked', async () => {
    await call('keys:unlock', PW)
    const entry = (await call('keys:import', newKeyText(), 'locked one')) as { id: string }
    await call('keys:lock')
    h.answers.push(0)
    await call('keys:remove', entry.id)
    expect(h.dialogCalls).toHaveLength(1)
    expect(vault().list().some((k) => k.id === entry.id)).toBe(true)
  })
})

describe('app:clearData asks in the main process', () => {
  function seed(): string {
    const dir = h.dataDir
    writeFileSync(join(dir, 'settings.json'), '{}')
    writeFileSync(join(dir, 'networks.json'), '{}')
    mkdirSync(join(dir, 'logs'), { recursive: true })
    writeFileSync(join(dir, 'logs', 'a.log'), 'x')
    return dir
  }
  const intact = (dir: string): boolean =>
    existsSync(join(dir, 'settings.json')) && existsSync(join(dir, 'networks.json')) && existsSync(join(dir, 'logs', 'a.log')) && existsSync(join(dir, 'vault.json'))

  it('Cancel in the first dialog removes nothing (no toolchain, no file, no restart)', async () => {
    const dir = seed()
    h.answers.push(0)
    await call('app:clearData', false, '')
    expect(h.dialogCalls).toHaveLength(1)
    expect(h.dialogCalls[0].detail).toContain('default-tc')
    expect(h.dialogCalls[0].detail).toContain('extra-tc')
    expect(h.removed).toEqual([])
    expect(intact(dir)).toBe(true)
    expect(h.exit).not.toHaveBeenCalled()
  })
  it('Cancel in the vault dialog removes nothing, even after the first one was confirmed', async () => {
    const dir = seed()
    h.answers.push(1, 0)
    await call('app:clearData', true, 'delete my keys')
    expect(h.dialogCalls).toHaveLength(2)
    expect(h.dialogCalls[1].detail).toContain('vault.json')
    expect(h.dialogCalls[1].detail).toMatch(/Keys in it: \d+/)
    expect(h.removed).toEqual([])
    expect(intact(dir)).toBe(true)
    expect(h.exit).not.toHaveBeenCalled()
  })
  it('without the vault flag the vault dialog is not shown and vault.json stays', async () => {
    const dir = seed()
    h.answers.push(1)
    await call('app:clearData', false, '')
    expect(h.dialogCalls).toHaveLength(1)
    expect(h.removed).toEqual(['default-tc', 'extra-tc'])
    expect(existsSync(join(dir, 'settings.json'))).toBe(false)
    expect(existsSync(join(dir, 'logs'))).toBe(false)
    expect(existsSync(join(dir, 'vault.json'))).toBe(true)
    expect(h.exit).toHaveBeenCalledWith(0)
  })
  it('both confirmed with the vault: the vault file goes too', async () => {
    const dir = seed()
    h.answers.push(1, 1)
    await call('app:clearData', true, 'delete my keys')
    expect(existsSync(join(dir, 'vault.json'))).toBe(false)
    expect(h.exit).toHaveBeenCalledWith(0)
  })
})

describe('lock triggers', () => {
  async function unlocked(): Promise<void> {
    if (!vault().exists()) await call('keys:create', PW, PW)
    else if (!vault().isUnlocked()) await call('keys:unlock', PW)
    expect(vault().isUnlocked()).toBe(true)
  }
  beforeEach(async () => {
    // The previous suite may have removed the vault; start from a fresh one.
    if (!vault().exists()) {
      ;(vault() as unknown as { data: unknown }).data = null
    }
    await unlocked()
  })

  it('suspend locks', async () => {
    h.power.get('suspend')!()
    expect(vault().isUnlocked()).toBe(false)
  })
  it('lock-screen locks', async () => {
    h.power.get('lock-screen')!()
    expect(vault().isUnlocked()).toBe(false)
  })
  it('before-quit locks', async () => {
    h.appEvents.get('before-quit')!()
    expect(vault().isUnlocked()).toBe(false)
  })
  it('idle time past the setting locks; less idle time does not', async () => {
    h.idle = 60
    vi.advanceTimersByTime(30_000)
    expect(vault().isUnlocked()).toBe(true)
    h.idle = 15 * 60
    vi.advanceTimersByTime(30_000)
    expect(vault().isUnlocked()).toBe(false)
    h.idle = 0
  })
  it('locking closes the reveal windows, and reveal does not unlock the vault', async () => {
    const entry = (await call('keys:import', newKeyText(), 'r')) as { id: string }
    await call('keys:reveal', entry.id)
    const rec = h.windows[h.windows.length - 1]
    expect(rec.closed).toBe(false)
    await call('keys:lock')
    expect(rec.closed).toBe(true)
    // A reveal on a locked vault shows the key and leaves the vault locked.
    await call('keys:reveal', entry.id)
    const rec2 = h.windows[h.windows.length - 1]
    const fromWindow = event('app://bundle/confirm.html', { id: rec2.id })
    const shown = (await h.handlers.get('reveal:show')!(fromWindow, PW)) as string
    expect(shown.startsWith('PVT_K1_')).toBe(true)
    expect(vault().isUnlocked()).toBe(false)
    // Another suspend event closes the window although the vault was already locked.
    h.power.get('suspend')!()
    expect(rec2.closed).toBe(true)
  })
  it('reveal calls are refused from the editor window', async () => {
    await expect((async () => h.handlers.get('reveal:show')!(good, PW))()).rejects.toThrow('Refused')
    await expect((async () => h.handlers.get('reveal:load')!(good))()).rejects.toThrow('Refused')
  })
})
