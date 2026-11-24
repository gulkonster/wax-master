// Preload of the confirmation window: the approval record to display and two
// calls (approve, cancel); in reveal mode the key reveal calls.

import { contextBridge, ipcRenderer } from 'electron'

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
applyTheme(process.argv.find((a) => a.startsWith('--wax-theme='))?.slice('--wax-theme='.length))
ipcRenderer.on('theme', (_e, theme: unknown) => applyTheme(theme))

contextBridge.exposeInMainWorld('confirmation', {
  load: (): Promise<unknown> => ipcRenderer.invoke('confirm:load'),
  approve: (id: string, typedName?: string): Promise<unknown> => ipcRenderer.invoke('confirm:approve', id, typedName),
  cancel: (id: string): Promise<unknown> => ipcRenderer.invoke('confirm:cancel', id),
  revealLoad: (): Promise<unknown> => ipcRenderer.invoke('reveal:load'),
  revealShow: (password: string): Promise<unknown> => ipcRenderer.invoke('reveal:show', password),
  revealCopy: (password: string): Promise<unknown> => ipcRenderer.invoke('reveal:copy', password)
})
