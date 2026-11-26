// Preload of the confirmation window: the approval record to display and two
// calls (approve, cancel); in the key windows the calls of their mode (each
// checked again by the main process against the window it comes from).

import { contextBridge, ipcRenderer } from 'electron'
import { themeFromArgv } from '../shared/theme'

// The resolved theme (dark or light) on <html data-theme>: from the start
// arguments before the first paint, then from the main process on each change.
// Only the two fixed values are applied; the page itself gets no new call.
interface ThemeDoc {
  documentElement: { setAttribute(name: string, value: string): void } | null
}
const themeGlobals = globalThis as unknown as {
  document: ThemeDoc
  MutationObserver: new (cb: () => void) => { observe(target: unknown, opts: { childList: boolean }): void; disconnect(): void }
}
function applyTheme(theme: unknown): void {
  if (theme !== 'dark' && theme !== 'light') return
  const doc = themeGlobals.document
  if (doc.documentElement) {
    doc.documentElement.setAttribute('data-theme', theme)
    return
  }
  const watch = new themeGlobals.MutationObserver(() => {
    if (!doc.documentElement) return
    doc.documentElement.setAttribute('data-theme', theme)
    watch.disconnect()
  })
  watch.observe(doc, { childList: true })
}
applyTheme(themeFromArgv(process.argv))
ipcRenderer.on('theme', (_e, theme: unknown) => applyTheme(theme))

contextBridge.exposeInMainWorld('confirmation', {
  load: (): Promise<unknown> => ipcRenderer.invoke('confirm:load'),
  approve: (id: string): Promise<unknown> => ipcRenderer.invoke('confirm:approve', id),
  cancel: (id: string): Promise<unknown> => ipcRenderer.invoke('confirm:cancel', id),
  revealLoad: (): Promise<unknown> => ipcRenderer.invoke('reveal:load'),
  revealShow: (password: string): Promise<unknown> => ipcRenderer.invoke('reveal:show', password),
  revealCopy: (password: string): Promise<unknown> => ipcRenderer.invoke('reveal:copy', password),
  keyLoad: (): Promise<unknown> => ipcRenderer.invoke('keywin:load'),
  backupSave: (password: string): Promise<unknown> => ipcRenderer.invoke('keywin:backupSave', password),
  codeCopy: (): Promise<unknown> => ipcRenderer.invoke('keywin:codeCopy'),
  codeSave: (): Promise<unknown> => ipcRenderer.invoke('keywin:codeSave'),
  codeDone: (): Promise<unknown> => ipcRenderer.invoke('keywin:codeDone'),
  recover: (code: string, password: string, again: string): Promise<unknown> => ipcRenderer.invoke('keywin:recover', code, password, again),
  reset: (typed: string): Promise<unknown> => ipcRenderer.invoke('keywin:reset', typed),
  // A lock hid the recovery code: the page drops it at once (a reload follows).
  onCodeHidden: (cb: () => void): void => {
    ipcRenderer.on('keywin:hidden', () => cb())
  }
})
