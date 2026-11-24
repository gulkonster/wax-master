// Window hardening shared by every window of the app.

import { app, dialog, protocol, session, shell, type BrowserWindow, type WebContents, net } from 'electron'
import { join, normalize, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { log } from './log'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`

export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'"

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

/** Serves the bundled renderer files under app://bundle/ and nothing else. */
export function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'bundle') return new Response('Not found', { status: 404 })
    const root = rendererRoot()
    const target = normalize(join(root, decodeURIComponent(url.pathname)))
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    if (target.endsWith('.html')) headers.set('Content-Security-Policy', CSP)
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
    nodeIntegrationInSubFrames: false,
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

/** Global rules: deny permissions, deny navigation and new windows, no webviews. */
export function hardenSessions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
    contents.on('will-navigate', (ev, url) => {
      if (!isAllowedOrigin(url)) ev.preventDefault()
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

/** Checks that an IPC message comes from a page of the app itself. */
export function senderAllowed(wc: WebContents, frameUrl: string | undefined, allowedPages: string[]): boolean {
  const url = frameUrl ?? wc.getURL()
  if (!isAllowedOrigin(url)) {
    log.warn('IPC from unexpected origin refused')
    return false
  }
  const path = new URL(url).pathname
  return allowedPages.some((p) => path.endsWith(p))
}
