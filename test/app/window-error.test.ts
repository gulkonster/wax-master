// Errors of the editor page reach the main log through one checked, one-way
// channel: only the main frame of the editor page is heard, only the report's
// exact shape is accepted, the message is one short line, stack places are
// file:line:col of the app's own scripts only, and at most 20 lines a minute.
// A view that fails to draw shows a panel with Back to Home instead of an empty window.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const h = vi.hoisted(() => ({ lines: [] as string[], on: new Map<string, (...a: unknown[]) => void>() }))

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '', getAppPath: () => '', getVersion: () => '0.0.0', on: () => undefined },
  ipcMain: { handle: () => undefined, on: (ch: string, fn: (...a: unknown[]) => void) => h.on.set(ch, fn) },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import { setLogSink } from '../../src/main/log'
import { onWindowError, registerWindowErrors } from '../../src/main/window-errors'
import {
  MAX_WINDOW_ERROR_MESSAGE,
  WINDOW_ERROR_CHANNEL,
  makeWindowErrorReport,
  oneLine,
  parseWindowErrorReport,
  stackPlaces,
  windowErrorLimiter
} from '../../src/shared/window-error'

setLogSink((l) => h.lines.push(l))

function event(url: string, mainFrame = true): { senderFrame: unknown; sender: unknown } {
  const frame = { url }
  return { senderFrame: frame, sender: { id: 1, mainFrame: mainFrame ? frame : {} } }
}
const editor = event('app://bundle/index.html')
const ok = { kind: 'render', message: 'TypeError: x is not a function', places: ['index-abc.js:12:5'] }
const always = (): boolean => true

describe('window error reports: checks in the main process', () => {
  it('writes one line for a valid report from the editor page', () => {
    h.lines.length = 0
    expect(onWindowError(editor as never, ok, always)).toBe(true)
    expect(h.lines).toHaveLength(1)
    expect(h.lines[0]).toMatch(/ERROR A view failed to draw: TypeError: x is not a function \(at index-abc\.js:12:5\)$/)
  })

  it('ignores every other sender: a sub frame, the confirmation and terminal pages, another origin', () => {
    h.lines.length = 0
    for (const e of [
      event('app://bundle/index.html', false),
      event('app://bundle/confirm.html'),
      event('app://terminal/terminal.html'),
      event('https://example.com/index.html'),
      { senderFrame: null, sender: { mainFrame: null } }
    ]) {
      expect(onWindowError(e as never, ok, always)).toBe(false)
    }
    expect(h.lines).toEqual([])
  })

  it('refuses anything not exactly of the report shape', () => {
    const bad: unknown[] = [
      null,
      'text',
      [],
      42,
      {},
      { ...ok, extra: 1 },
      { kind: 'other', message: 'm', places: [] },
      { kind: 'error', message: 5, places: [] },
      { kind: 'error', message: '', places: [] },
      { kind: 'error', message: '   ', places: [] },
      { kind: 'error', message: 'x'.repeat(4 * MAX_WINDOW_ERROR_MESSAGE + 1), places: [] },
      { kind: 'error', message: 'm', places: 'index.js:1:1' },
      { kind: 'error', message: 'm', places: ['C:\\Users\\name\\file.js:1:1'] },
      { kind: 'error', message: 'm', places: ['app://bundle/assets/index.js:1:1'] },
      { kind: 'error', message: 'm', places: ['../index.js:1:1'] },
      { kind: 'error', message: 'm', places: ['index.js'] },
      { kind: 'error', message: 'm', places: [1] },
      { kind: 'error', message: 'm', places: Array(6).fill('index.js:1:1') }
    ]
    for (const b of bad) expect(parseWindowErrorReport(b), JSON.stringify(b)).toBeNull()
    h.lines.length = 0
    for (const b of bad) onWindowError(editor as never, b, always)
    expect(h.lines).toEqual([])
  })

  it('cuts the message to its first line of at most 500 characters, without control characters', () => {
    expect(oneLine('first\nsecond')).toBe('first')
    expect(oneLine('first\r\nsecond')).toBe('first')
    expect(oneLine(`a${String.fromCharCode(0x2028)}b`)).toBe('a')
    expect(oneLine(`a${String.fromCharCode(7)}b`)).toBe('a b')
    const long = oneLine('y'.repeat(2000))
    expect(long.length).toBe(MAX_WINDOW_ERROR_MESSAGE)
    expect(long.endsWith('...')).toBe(true)
    const r = parseWindowErrorReport({ kind: 'error', message: `${'z'.repeat(600)}\nC:\\Users\\name\\secret`, places: [] })
    expect(r?.message.length).toBe(MAX_WINDOW_ERROR_MESSAGE)
    expect(r?.message).not.toContain('Users')
  })

  it('passes the line through the log redaction', () => {
    h.lines.length = 0
    const key = '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'
    onWindowError(editor as never, { kind: 'error', message: `bad ${key}`, places: [] }, always)
    expect(h.lines[0]).not.toContain(key)
    expect(h.lines[0]).toContain('[redacted key]')
  })

  it('writes at most 20 lines a minute', () => {
    let t = 0
    const allow = windowErrorLimiter(20, () => t)
    const results = Array.from({ length: 25 }, () => allow())
    expect(results.filter(Boolean)).toHaveLength(20)
    t = 60_000
    expect(allow()).toBe(true)
  })

  it('is registered as a one-way listener on its own channel and never throws', () => {
    registerWindowErrors()
    const fn = h.on.get(WINDOW_ERROR_CHANNEL)
    expect(fn).toBeTypeOf('function')
    expect(() => fn!({ senderFrame: undefined, sender: undefined }, ok)).not.toThrow()
    expect(fn!(editor, ok)).toBeUndefined()
  })
})

describe('window error reports: what the page sends', () => {
  const origins = ['app://bundle']
  const stack = [
    'TypeError: destroy_ is not a function',
    '    at safelyCallDestroy (app://bundle/assets/jsx-runtime-DD.js:6151:9)',
    '    at x (C:\\Users\\name\\AppData\\file.js:1:2)',
    '    at y (file:///C:/Users/name/other.js:3:4)',
    '    at z (https://example.com/evil.js:5:6)',
    '    at w (app://bundle/assets/index-B8.js:195492:18)'
  ].join('\n')

  it("keeps only file:line:col of the app's own scripts", () => {
    expect(stackPlaces(stack, origins)).toEqual(['jsx-runtime-DD.js:6151:9', 'index-B8.js:195492:18'])
    expect(stackPlaces(undefined, origins)).toEqual([])
  })

  it('builds a report that passes the main-process check', () => {
    const e = new TypeError('destroy_ is not a function')
    e.stack = stack
    const r = makeWindowErrorReport('render', e, origins)
    expect(r).toEqual({ kind: 'render', message: 'TypeError: destroy_ is not a function', places: ['jsx-runtime-DD.js:6151:9', 'index-B8.js:195492:18'] })
    expect(parseWindowErrorReport(r)).toEqual(r)
    // A thrown value that is not an Error or text is never sent as it is.
    expect(makeWindowErrorReport('rejection', { secret: 'typed text' }, origins)).toEqual({ kind: 'rejection', message: 'a object was thrown', places: [] })
    expect(makeWindowErrorReport('error', undefined, origins).message).toBe('no error value')
  })

  it('the preload sends it one way on the channel', () => {
    const preload = readFileSync(join(__dirname, '../../src/preload/index.ts'), 'utf8')
    expect(preload).toContain('reportError: (report: unknown): void => ipcRenderer.send(WINDOW_ERROR_CHANNEL, report)')
  })
})

type Props = Record<string, unknown>
interface Boundary {
  state: { error: string | null }
  props: Props
  render(): unknown
  componentDidCatch(e: unknown, info: unknown): void
  componentDidUpdate(prev: Props): void
  setState(s: unknown): void
}
interface BoundaryClass {
  new (p: Props): Boundary
  getDerivedStateFromError(e: unknown): { error: string }
}
type ButtonEl = ReactElement<{ onClick?: () => void; children?: unknown }>

// The component is a .tsx file; the test settings have no JSX, so it is loaded by path.
const BOUNDARY = '../../src/renderer/src/components/ErrorBoundary'
const loadBoundary = async (): Promise<BoundaryClass> => ((await import(/* @vite-ignore */ BOUNDARY)) as { ErrorBoundary: BoundaryClass }).ErrorBoundary

function findButton(n: unknown): ButtonEl | null {
  if (Array.isArray(n)) return n.map(findButton).find((x) => x !== null) ?? null
  if (!isValidElement(n)) return null
  const el = n as ButtonEl
  return el.type === 'button' ? el : findButton(el.props.children)
}

describe('error boundary', () => {
  it('draws its children while nothing failed', async () => {
    const ErrorBoundary = await loadBoundary()
    const html = renderToStaticMarkup(createElement(ErrorBoundary as never, { onHome: () => undefined }, createElement('p', null, 'the view')))
    expect(html).toBe('<p>the view</p>')
  })

  it('a failed view becomes a panel with the error line and Back to Home', async () => {
    const ErrorBoundary = await loadBoundary()
    const state = ErrorBoundary.getDerivedStateFromError(new TypeError('destroy_ is not a function\nsecond line'))
    expect(state).toEqual({ error: 'destroy_ is not a function' })
    const onHome = vi.fn()
    const b = new ErrorBoundary({ onHome, what: 'The Documentation page' })
    b.state = state
    b.setState = (s: unknown) => Object.assign(b.state, s)
    const panel = b.render()
    const html = renderToStaticMarkup(panel as ReactElement)
    expect(html).toContain('The Documentation page could not be shown')
    expect(html).toContain('destroy_ is not a function')
    expect(html).not.toContain('second line')
    expect(html).toContain('Back to Home')
    // The button clears the panel and goes Home.
    findButton(panel)!.props.onClick!()
    expect(onHome).toHaveBeenCalledTimes(1)
    expect(b.state.error).toBeNull()
  })

  it('reports a caught error and clears the panel when the view changes', async () => {
    const ErrorBoundary = await loadBoundary()
    const report = vi.fn()
    const b = new ErrorBoundary({ onHome: () => undefined, report, resetKey: 'docs' })
    const err = new Error('boom')
    b.componentDidCatch(err, { componentStack: '' })
    expect(report).toHaveBeenCalledWith(err)
    b.state = { error: 'boom' }
    b.setState = (s: unknown) => Object.assign(b.state, s)
    b.componentDidUpdate({ ...b.props, resetKey: 'docs' })
    expect(b.state.error).toBe('boom')
    b.componentDidUpdate({ ...b.props, resetKey: 'home' })
    expect(b.state.error).toBeNull()
  })

  it('wraps the main view area and the help window; the page reports uncaught errors from the start', () => {
    const app = readFileSync(join(__dirname, '../../src/renderer/src/App.tsx'), 'utf8')
    expect(app).toMatch(/<ErrorBoundary resetKey=\{state\.view\} onHome=\{goHome\}>\s*\{state\.view === 'home' && <Home \/>\}[\s\S]*?\{state\.view === 'docs' && <DocsPage \/>\}[\s\S]*?<\/ErrorBoundary>/)
    for (const page of ['ProjectView', 'AccountPage', 'ContractPage']) expect(app).toMatch(new RegExp(`<ErrorBoundary[^>]*>\\s*<${page}[ /]`))
    const help = readFileSync(join(__dirname, '../../src/renderer/src/components/Help.tsx'), 'utf8')
    expect(help).toMatch(/<ErrorBoundary[^>]*>\s*<DocViewer/)
    const main = readFileSync(join(__dirname, '../../src/renderer/src/main.tsx'), 'utf8')
    expect(main).toMatch(/installWindowErrorReports\(\)\s+createRoot/)
  })
})
