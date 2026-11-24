// Preload of the confirmation window: the approval record to display and two
// calls (approve, cancel); in reveal mode the key reveal calls.

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('confirmation', {
  load: (): Promise<unknown> => ipcRenderer.invoke('confirm:load'),
  approve: (id: string, typedName?: string): Promise<unknown> => ipcRenderer.invoke('confirm:approve', id, typedName),
  cancel: (id: string): Promise<unknown> => ipcRenderer.invoke('confirm:cancel', id),
  revealLoad: (): Promise<unknown> => ipcRenderer.invoke('reveal:load'),
  revealShow: (password: string): Promise<unknown> => ipcRenderer.invoke('reveal:show', password),
  revealCopy: (password: string): Promise<unknown> => ipcRenderer.invoke('reveal:copy', password)
})
