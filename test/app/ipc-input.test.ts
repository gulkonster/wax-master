import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => 'C:\\nonexistent-waxm',
    getAppPath: () => 'C:\\nonexistent-waxm',
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
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
const good = event('app://bundle/index.html')

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn(good, ...args)
}

beforeAll(() => registerIpc(() => null))

describe('IPC sender checks', () => {
  it('refuses a foreign origin', async () => {
    await expect(h.handlers.get('settings:get')!(event('https://example.com/index.html'))).rejects.toThrow('Refused')
  })
  it('refuses the confirmation page', async () => {
    await expect(h.handlers.get('settings:get')!(event('app://bundle/confirm.html'))).rejects.toThrow('Refused')
  })
  it('refuses a sub frame', async () => {
    await expect(h.handlers.get('settings:get')!(event('app://bundle/index.html', false))).rejects.toThrow('Refused')
  })
})

describe('IPC malformed input', () => {
  const cases: [string, unknown[]][] = [
    ['app:openExternal', [42]],
    ['settings:set', ['text']],
    ['settings:set', [{ fontSize: 'big' }]],
    ['settings:set', [{ fontSize: 3 }]],
    ['settings:set', [{ autoLockMinutes: 7 }]],
    ['settings:set', [{ lockAfterSignature: 'yes' }]],
    ['settings:set', [{ terminalProfile: 'bash' }]],
    ['settings:set', [{ defaultProjectFolder: '\\\\server\\share' }]],
    ['settings:set', [{ defaultProjectFolder: 'relative\\dir' }]],
    ['projects:create', ['bogus', 'name', 'C:\\x']],
    ['projects:create', ['empty', 'name', '\\\\?\\C:\\x']],
    ['projects:create', ['empty', 'name', 'C:\\a\\..\\b']],
    ['projects:create', ['empty', 7, 'C:\\x']],
    ['projects:chooseParentFolder', [null]],
    ['projects:open', [{}]],
    ['projects:setMainFile', ['..\\x.cpp']],
    ['projects:saveConfig', ['text']],
    ['projects:star', ['C:\\x', 'yes']],
    ['projects:remove', [1]],
    ['files:read', [123]],
    ['files:read', ['../x']],
    ['files:read', ['src/a.cpp:stream']],
    ['files:read', ['CON']],
    ['files:stat', [123]],
    ['files:stat', ['../x']],
    ['files:stat', ['C:/x']],
    ['files:stat', ['src/a.cpp:stream']],
    ['files:stat', ['CON']],
    ['files:write', ['a.txt', 5]],
    ['files:write', ['C:/x', 'text']],
    ['files:create', ['a.txt', 'dir']],
    ['files:rename', ['a', '../b']],
    ['files:remove', ['/abs']],
    ['files:reveal', [null]],
    ['files:writeExternal', [1, 'text']],
    ['files:writeExternal', ['t', 1]],
    ['toolchain:enableWsl', ['yes']],
    ['toolchain:install', [3]]
  ]
  for (const [channel, args] of cases) {
    it(`${channel} refuses ${JSON.stringify(args)}`, async () => {
      await expect(call(channel, ...args)).rejects.toThrow()
    })
  }
})
