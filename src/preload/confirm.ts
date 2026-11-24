// Preload of the confirmation window: two calls only (approve, cancel) and the
// approval record to display. Filled in with the signer.

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('confirmation', {
  load: (): Promise<unknown> => ipcRenderer.invoke('confirm:load'),
  approve: (id: string, typedName?: string): Promise<unknown> => ipcRenderer.invoke('confirm:approve', id, typedName),
  cancel: (id: string): Promise<unknown> => ipcRenderer.invoke('confirm:cancel', id)
})
