// Window hardening shared by every window of the app.

import { app, dialog, protocol, session, shell, type BrowserWindow, net } from 'electron'
import { join, normalize, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TERMINAL_HOST, TERMINAL_ORIGIN, TERMINAL_PAGE, terminalPageUrl } from '../shared/terminal-frame'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`
/** The terminal page is served from its own origin so it runs apart from the editor page. */
export const TERMINAL_FRAME_ORIGIN = TERMINAL_ORIGIN
export const TERMINAL_FRAME_URL = `${TERMINAL_ORIGIN}${TERMINAL_PAGE}`

function policy(frameSrc: string): string {
  return (
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    `font-src 'self'; connect-src 'none'; worker-src 'self' blob:; frame-src ${frameSrc}; ` +
    "object-src 'none'; base-uri 'none'; form-action 'none'"
  )
}

/** Editor page: may embed the terminal page and nothing else. */
export const CSP = policy(TERMINAL_ORIGIN)
/** Confirmation window: embeds nothing. */
export const CONFIRM_CSP = policy("'none'")
/** Terminal page: embeds nothing and may only be embedded by the editor page. */
export const TERMINAL_CSP = `${policy("'none'")}; frame-ancestors ${APP_ORIGIN}`

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

/**
 * Which bundled file an app:// request may load, and its policy.
 * app://bundle/ serves every page and asset except the terminal page;
 * app://terminal/ serves only the terminal page and the shared assets.
 */
export function appRequestTarget(host: string, pathname: string): { rel: string; csp?: string } | null {
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const rel = normalize(path).replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes('\0')) return null
  const page = rel.toLowerCase()
  if (host === 'bundle') {
    if (page === TERMINAL_PAGE.slice(1)) return null
    if (page === 'index.html') return { rel, csp: CSP }
    if (page.endsWith('.html')) return { rel, csp: CONFIRM_CSP }
    return { rel }
  }
  if (host === TERMINAL_HOST) {
    if (page === TERMINAL_PAGE.slice(1)) return { rel, csp: TERMINAL_CSP }
    if (page.startsWith('assets/') && !page.endsWith('.html')) return { rel }
    return null
  }
  return null
}

/** Serves the bundled renderer files under app://bundle/ and app://terminal/ and nothing else. */
export function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const t = appRequestTarget(url.host, url.pathname)
    if (!t) return new Response('Not found', { status: 404 })
    const root = rendererRoot()
    const target = normalize(join(root, t.rel))
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    if (t.csp) headers.set('Content-Security-Policy', t.csp)
    return new Response(res.body, { status: res.status, headers })
  })
}

export function secureWebPreferences(preload: string): Electron.WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    // The preload also runs in sub frames (sandboxed, isolated); it exposes the
    // terminal calls only in the app://terminal frame and the editor calls only
    // in the main frame of app://bundle.
    nodeIntegrationInSubFrames: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    devTools: !app.isPackaged
  }
}

export function isAllowedOrigin(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true
  const dev = process.env.ELECTRON_RENDERER_URL
  return !app.isPackaged && !!dev && url.startsWith(dev)
}

/** The terminal page address: app://terminal/terminal.html, or its development server twin. */
export function terminalFrameUrl(): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) return terminalPageUrl(dev)
  return TERMINAL_FRAME_URL
}

/** True only for the terminal page itself (any query or fragment ignored). */
export function isTerminalFrameUrl(url: string): boolean {
  const base = url.split(/[?#]/)[0]
  if (base === TERMINAL_FRAME_URL) return true
  const dev = process.env.ELECTRON_RENDERER_URL
  return !app.isPackaged && !!dev && base === terminalPageUrl(dev)
}

/** Global rules: deny permissions, deny navigation and new windows, no webviews. */
export function hardenSessions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
    contents.on('will-navigate', (ev, url) => {
      if (!isAllowedOrigin(url)) ev.preventDefault()
    })
    // A sub frame may only hold the terminal page.
    contents.on('will-frame-navigate', (ev) => {
      if (!ev.isMainFrame && !isTerminalFrameUrl(ev.url)) ev.preventDefault()
    })
    contents.on('will-redirect', (ev, url) => {
      if (!isAllowedOrigin(url)) ev.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

/** Opens an https link in the system browser after showing the address. */
export async function openExternalConfirmed(parent: BrowserWindow | null, url: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const opts = {
    type: 'question' as const,
    buttons: ['Open', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Open link',
    message: 'Open this address in your browser?',
    detail: parsed.toString()
  }
  const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts)
  if (r.response !== 0) return false
  await shell.openExternal(parsed.toString())
  return true
}
