// Exposes the fixed WAX Master interface to the editor window. There is no
// generic passthrough: every call below maps to one validated handler.

import { contextBridge, ipcRenderer } from 'electron'
import type { WaxApi } from '../shared/api'

const call =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

const EVENTS = new Set(['menu', 'files-changed'])

const api: WaxApi = {
  app: {
    info: call('app:info'),
    openExternal: call('app:openExternal')
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set')
  },
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    chooseParentFolder: call('projects:chooseParentFolder'),
    openDialog: call('projects:openDialog'),
    open: call('projects:open'),
    setMainFile: call('projects:setMainFile'),
    saveConfig: call('projects:saveConfig'),
    star: call('projects:star'),
    remove: call('projects:remove'),
    close: call('projects:close')
  },
  files: {
    tree: call('files:tree'),
    read: call('files:read'),
    write: call('files:write'),
    create: call('files:create'),
    rename: call('files:rename'),
    remove: call('files:remove'),
    reveal: call('files:reveal'),
    saveAs: call('files:saveAs'),
    openDialog: call('files:openDialog'),
    writeExternal: call('files:writeExternal')
  },
  on(event: string, cb: (...args: never[]) => void): () => void {
    if (!EVENTS.has(event)) throw new Error('Unknown event')
    const listener = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
} as WaxApi

contextBridge.exposeInMainWorld('wax', api)
