import { beforeAll, describe, expect, it, vi } from 'vitest'

// Terminal isolation: the shell and clipboard calls are accepted only from the
// terminal page (app://terminal) embedded in the editor page; the editor page,
// a foreign origin and any other frame are refused.

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>(),
  ptyListener: null as null | ((m: { type: string; id: string; data?: string; code?: number }) => void),
  started: [] as string[],
  written: [] as string[],
  clipboardWrites: [] as string[]
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => 'C:\\nonexistent-waxm',
    getAppPath: () => 'C:\\nonexistent-waxm',
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  clipboard: {
    readText: () => 'clipboard text',
    writeText: (t: string) => void h.clipboardWrites.push(t)
  },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

vi.mock('../../src/main/helper', async (orig) => ({
  ...(await orig<typeof import('../../src/main/helper')>()),
  onPtyMessage: (fn: typeof h.ptyListener) => {
    h.ptyListener = fn
  },
  ptyStart: (id: string) => void h.started.push(id),
  ptyInput: (_id: string, data: string) => void h.written.push(data),
  ptyResize: () => undefined,
  ptyKill: () => undefined
}))

import { registerIpc } from '../../src/main/ipc'
import { CSP, TERMINAL_CSP, appRequestTarget } from '../../src/main/security'
import { parseTerminalCommand, parseTerminalFrameEvent, terminalPageUrl } from '../../src/shared/terminal-frame'

interface Frame {
  url: string
  parent: Frame | null
  sent: unknown[][]
  send: (...a: unknown[]) => void
  isDestroyed: () => boolean
  detached: boolean
}

function frame(url: string, parent: Frame | null): Frame {
  const f: Frame = {
    url,
    parent,
    sent: [],
    send: (...a: unknown[]) => void f.sent.push(a),
    isDestroyed: () => false,
    detached: false
  }
  return f
}

interface Page {
  main: Frame
  sent: unknown[][]
  event(f: Frame): unknown
}

function page(mainUrl = 'app://bundle/index.html'): Page {
  const main = frame(mainUrl, null)
  const sent: unknown[][] = []
  const sender = { mainFrame: main, send: (...a: unknown[]) => void sent.push(a), isDestroyed: () => false }
  return { main, sent, event: (f: Frame) => ({ senderFrame: f, sender }) }
}

const editor = page()
const terminalFrame = frame('app://terminal/terminal.html', editor.main)

function invoke(channel: string, e: unknown, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn(e, ...args)
}

const CALLS: [string, unknown[]][] = [
  ['terminal:profiles', []],
  ['terminal:create', ['powershell', null, 80, 24]],
  ['terminal:write', ['some-id', 'echo hi\r']],
  ['terminal:resize', ['some-id', 80, 24]],
  ['terminal:kill', ['some-id']],
  ['clipboard:readText', []],
  ['clipboard:writeText', ['text']]
]

beforeAll(() => registerIpc(() => null))

describe('terminal and clipboard calls: refused outside the terminal frame', () => {
  const senders: [string, () => unknown][] = [
    ['the editor page (main frame of app://bundle)', () => editor.event(editor.main)],
    ['a foreign origin frame in the editor page', () => editor.event(frame('https://example.com/terminal.html', editor.main))],
    ['a foreign origin main frame', () => page('https://example.com/index.html').event(page('https://example.com/index.html').main)],
    ['app://bundle/terminal.html as a sub frame', () => editor.event(frame('app://bundle/terminal.html', editor.main))],
    ['another app://terminal page', () => editor.event(frame('app://terminal/index.html', editor.main))],
    ['the terminal page nested one level deeper', () => {
      const mid = frame('app://terminal/terminal.html', editor.main)
      return editor.event(frame('app://terminal/terminal.html', mid))
    }],
    ['the terminal page as the main frame of a window', () => {
      const p = page('app://terminal/terminal.html')
      return p.event(p.main)
    }],
    ['the terminal page inside the confirmation window', () => {
      const p = page('app://bundle/confirm.html')
      return p.event(frame('app://terminal/terminal.html', p.main))
    }],
    ['the development server address in a packaged build', () => editor.event(frame('http://localhost:5173/terminal.html', editor.main))]
  ]
  for (const [who, ev] of senders) {
    for (const [channel, args] of CALLS) {
      it(`${channel} from ${who}`, async () => {
        await expect(invoke(channel, ev(), ...args)).rejects.toThrow('Refused')
      })
    }
  }
  it('nothing reached the shell or the clipboard', () => {
    expect(h.started).toEqual([])
    expect(h.written).toEqual([])
    expect(h.clipboardWrites).toEqual([])
  })
})

describe('terminal and clipboard calls: accepted from the terminal frame', () => {
  const ev = (): unknown => editor.event(terminalFrame)
  it('lists the profiles', async () => {
    const r = (await invoke('terminal:profiles', ev())) as { profiles: { id: string }[] }
    expect(r.profiles.map((p) => p.id)).toEqual(['powershell', 'cmd', 'toolchain'])
  })
  it('reads and writes the clipboard', async () => {
    expect(await invoke('clipboard:readText', ev())).toBe('clipboard text')
    await invoke('clipboard:writeText', ev(), 'copied')
    expect(h.clipboardWrites).toEqual(['copied'])
  })
  it('opens a shell, writes to it, and sends its output to the frame only', async () => {
    const id = (await invoke('terminal:create', ev(), 'cmd', null, 80, 24)) as string
    expect(h.started).toEqual([id])
    await invoke('terminal:write', ev(), id, 'dir\r')
    expect(h.written).toEqual(['dir\r'])
    h.ptyListener!({ type: 'pty-data', id, data: 'output' })
    h.ptyListener!({ type: 'pty-exit', id, code: 0 })
    expect(terminalFrame.sent).toEqual([
      ['terminal-data', id, 'output'],
      ['terminal-exit', id, 0, '']
    ])
    expect(editor.sent).toEqual([])
    expect(editor.main.sent).toEqual([])
  })
  it('still validates the arguments', async () => {
    await expect(invoke('terminal:create', ev(), 'bash', null, 80, 24)).rejects.toThrow()
    await expect(invoke('terminal:create', ev(), 'cmd', '../outside', 80, 24)).rejects.toThrow()
    await expect(invoke('terminal:write', ev(), 'id', 42)).rejects.toThrow()
  })
  it('the terminal frame cannot call the editor handlers', async () => {
    await expect(invoke('settings:get', ev())).rejects.toThrow('Refused')
    await expect(invoke('files:read', ev(), 'a.cpp')).rejects.toThrow('Refused')
  })
})

describe('policies and served files', () => {
  const directive = (policy: string, name: string): string[] =>
    (policy.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1)

  it('the editor page may frame app://terminal and nothing broader', () => {
    expect(directive(CSP, 'frame-src')).toEqual(['app://terminal'])
    expect(directive(CSP, 'child-src')).toEqual([])
    expect(directive(CSP, 'default-src')).toEqual(["'none'"])
  })
  it('the terminal page embeds nothing and is embedded only by app://bundle', () => {
    expect(directive(TERMINAL_CSP, 'frame-src')).toEqual(["'none'"])
    expect(directive(TERMINAL_CSP, 'frame-ancestors')).toEqual(['app://bundle'])
    expect(directive(TERMINAL_CSP, 'connect-src')).toEqual(["'none'"])
  })
  it('app://bundle does not serve the terminal page', () => {
    expect(appRequestTarget('bundle', '/terminal.html')).toBeNull()
    expect(appRequestTarget('bundle', '/TERMINAL.HTML')).toBeNull()
    expect(appRequestTarget('bundle', '/index.html')).toEqual({ rel: 'index.html', csp: CSP })
  })
  it('app://terminal serves only the terminal page and assets', () => {
    expect(appRequestTarget('terminal', '/terminal.html')).toEqual({ rel: 'terminal.html', csp: TERMINAL_CSP })
    expect(appRequestTarget('terminal', '/assets/terminal-x.js')).toEqual({ rel: 'assets/terminal-x.js' })
    expect(appRequestTarget('terminal', '/index.html')).toBeNull()
    expect(appRequestTarget('terminal', '/confirm.html')).toBeNull()
    expect(appRequestTarget('terminal', '/assets/../index.html')).toBeNull()
    expect(appRequestTarget('terminal', '/%2e%2e/main/index.js')).toBeNull()
    expect(appRequestTarget('other', '/terminal.html')).toBeNull()
  })
  it('frame address: app://terminal when built, the other loopback name on the development server', () => {
    expect(terminalPageUrl('app://bundle/index.html')).toBe('app://terminal/terminal.html')
    expect(terminalPageUrl('http://127.0.0.1:5173/')).toBe('http://localhost:5173/terminal.html')
  })
})

describe('messages from the editor window to the terminal frame', () => {
  it('accepts the fixed commands', () => {
    expect(parseTerminalCommand({ type: 'new', profile: 'cmd' })).toEqual({ type: 'new', profile: 'cmd' })
    expect(parseTerminalCommand({ type: 'show', profile: 'powershell' })).toEqual({ type: 'show', profile: 'powershell' })
    expect(parseTerminalCommand({ type: 'open-here', profile: 'toolchain', path: 'src/lib' })).toEqual({
      type: 'open-here',
      profile: 'toolchain',
      path: 'src/lib'
    })
    expect(parseTerminalCommand({ type: 'hide' })).toEqual({ type: 'hide' })
    expect(parseTerminalCommand({ type: 'focus' })).toEqual({ type: 'focus' })
    expect(parseTerminalCommand({ type: 'fit' })).toEqual({ type: 'fit' })
    expect(parseTerminalCommand({ type: 'font-size', size: 13 })).toEqual({ type: 'font-size', size: 13 })
  })
  it('refuses text for the shell and anything else', () => {
    const bad: unknown[] = [
      null,
      'new',
      ['new'],
      { type: 'write', data: 'calc\r' },
      { type: 'paste', text: 'calc\r' },
      { type: 'new', profile: 'powershell', text: 'calc\r' },
      { type: 'new', profile: 'bash' },
      { type: 'new', profile: 'powershell -c calc' },
      { type: 'open-here', profile: 'cmd', path: '../..' },
      { type: 'open-here', profile: 'cmd', path: 'C:\\Windows' },
      { type: 'open-here', profile: 'cmd', path: '/etc' },
      { type: 'open-here', profile: 'cmd', path: 'a\r\ncalc' },
      { type: 'open-here', profile: 'cmd', path: '' },
      { type: 'focus', text: 'x' },
      { type: 'font-size', size: '13' },
      { type: 'font-size', size: 1000 },
      { type: 'font-size', size: 12.5 }
    ]
    for (const m of bad) expect(parseTerminalCommand(m), JSON.stringify(m)).toBeNull()
  })
  it('frame events: only ready and notices', () => {
    expect(parseTerminalFrameEvent({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseTerminalFrameEvent({ type: 'notice', title: 't', text: 'x', error: true })).toEqual({
      type: 'notice',
      title: 't',
      text: 'x',
      error: true
    })
    expect(parseTerminalFrameEvent({ type: 'run', command: 'x' })).toBeNull()
  })
})
