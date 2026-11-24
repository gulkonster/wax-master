// Exposes the fixed WAX Master interface to the editor window. There is no
// generic passthrough: every call below maps to one validated handler.

import { contextBridge, ipcRenderer } from 'electron'
import type { WaxApi } from '../shared/api'

const call =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

const EVENTS = new Set(['menu', 'files-changed', 'output', 'setup-progress', 'terminal-data', 'terminal-exit', 'network-changed', 'vault-changed', 'update-available', 'editor-status', 'editor-message'])

const api: WaxApi = {
  app: {
    info: call('app:info'),
    openExternal: call('app:openExternal'),
    setDirty: call('app:setDirty'),
    checkUpdates: call('app:checkUpdates'),
    clearData: call('app:clearData'),
    quitNow: call('app:quitNow')
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
    writeExternal: call('files:writeExternal'),
    wasmInfo: call('files:wasmInfo'),
    search: call('files:search')
  },
  editor: {
    start: call('editor:start'),
    status: call('editor:status'),
    send: call('editor:send'),
    readToolchainFile: call('editor:readToolchainFile')
  },
  toolchain: {
    status: call('toolchain:status'),
    enableWsl: call('toolchain:enableWsl'),
    install: call('toolchain:install'),
    testBuild: call('toolchain:testBuild'),
    restartComputer: call('toolchain:restartComputer')
  },
  networks: {
    list: call('networks:list'),
    select: call('networks:select'),
    probe: call('networks:probe'),
    add: call('networks:add'),
    update: call('networks:update'),
    remove: call('networks:remove'),
    chooseEndpoint: call('networks:chooseEndpoint'),
    stars: call('networks:stars'),
    setStar: call('networks:setStar'),
    setStarOrder: call('networks:setStarOrder')
  },
  chain: {
    account: call('chain:account'),
    actions: call('chain:actions')
  },
  contract: {
    abi: call('contract:abi'),
    pack: call('contract:pack'),
    rows: call('contract:rows'),
    scopes: call('contract:scopes'),
    historyList: call('contract:historyList'),
    historyAdd: call('contract:historyAdd'),
    historyRemove: call('contract:historyRemove')
  },
  keys: {
    status: call('keys:status'),
    create: call('keys:create'),
    unlock: call('keys:unlock'),
    lock: call('keys:lock'),
    list: call('keys:list'),
    newPending: call('keys:newPending'),
    savePending: call('keys:savePending'),
    discardPending: call('keys:discardPending'),
    import: call('keys:import'),
    setLabel: call('keys:setLabel'),
    remove: call('keys:remove'),
    reveal: call('keys:reveal'),
    accounts: call('keys:accounts'),
    exportVault: call('keys:exportVault'),
    importVault: call('keys:importVault')
  },
  tx: {
    run: call('tx:run'),
    simulate: call('tx:simulate'),
    simulationSupport: call('tx:simulationSupport'),
    open: call('tx:open')
  },
  deploy: {
    plan: call('deploy:plan'),
    simulate: call('deploy:simulate'),
    run: call('deploy:run')
  },
  accounts: {
    create: call('accounts:create'),
    changeKey: call('accounts:changeKey'),
    clearCode: call('accounts:clearCode')
  },
  clipboard: {
    writeText: call('clipboard:writeText'),
    readText: call('clipboard:readText')
  },
  terminal: {
    profiles: call('terminal:profiles'),
    create: call('terminal:create'),
    write: call('terminal:write'),
    resize: call('terminal:resize'),
    kill: call('terminal:kill')
  },
  build: {
    run: call('build:run'),
    defaultCommand: call('build:defaultCommand')
  },
  on(event: string, cb: (...args: never[]) => void): () => void {
    if (!EVENTS.has(event)) throw new Error('Unknown event')
    const listener = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
} as WaxApi

contextBridge.exposeInMainWorld('wax', api)
