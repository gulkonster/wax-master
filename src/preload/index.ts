// Exposes the fixed WAX Master interface. There is no generic passthrough:
// every call below maps to one validated handler. The editor calls are exposed
// only in the main frame of the editor page; the terminal calls only in the
// terminal frame (app://terminal). The main process checks the sender again.

import { contextBridge, ipcRenderer } from 'electron'
import type { WaxApi, WaxTerminalApi } from '../shared/api'
import { themeFromArgv } from '../shared/theme'
import { devUrlFromArgv, interfaceFor } from '../shared/preload-exposure'
import { WINDOW_ERROR_CHANNEL } from '../shared/window-error'

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

const call =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

// The preload runs in a page; this build's type settings have no DOM types.
const page = globalThis as unknown as {
  top: unknown
  location: { origin: string; pathname: string }
}
const exposed = interfaceFor(
  { isTopFrame: page.top === globalThis, origin: page.location.origin, pathname: page.location.pathname },
  devUrlFromArgv(process.argv)
)

const EVENTS = new Set(['menu', 'files-changed', 'output', 'setup-progress', 'network-changed', 'network-status', 'vault-changed', 'update-available', 'editor-status', 'editor-message'])
const TERMINAL_EVENTS = new Set(['terminal-data', 'terminal-exit'])

function subscribe(allowed: Set<string>, event: string, cb: (...args: never[]) => void): () => void {
  if (!allowed.has(event)) throw new Error('Unknown event')
  const listener = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
  ipcRenderer.on(event, listener)
  return () => ipcRenderer.removeListener(event, listener)
}

const terminalApi: WaxTerminalApi = {
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
  on(event: string, cb: (...args: never[]) => void): () => void {
    return subscribe(TERMINAL_EVENTS, event, cb)
  }
} as WaxTerminalApi

const api: WaxApi = {
  app: {
    info: call('app:info'),
    openExternal: call('app:openExternal'),
    setDirty: call('app:setDirty'),
    checkUpdates: call('app:checkUpdates'),
    clearData: call('app:clearData'),
    quitNow: call('app:quitNow'),
    // One way, no answer: the main process writes a checked line to its log.
    reportError: (report: unknown): void => ipcRenderer.send(WINDOW_ERROR_CHANNEL, report)
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
    stat: call('files:stat'),
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
    removedDefaults: call('networks:removedDefaults'),
    restoreDefaults: call('networks:restoreDefaults'),
    chooseEndpoint: call('networks:chooseEndpoint'),
    stars: call('networks:stars'),
    setStar: call('networks:setStar'),
    setStarOrder: call('networks:setStarOrder')
  },
  network: {
    status: call('network:status'),
    watchFast: call('network:watchFast')
  },
  chain: {
    account: call('chain:account'),
    accountExists: call('chain:accountExists'),
    actions: call('chain:actions'),
    ramPrice: call('chain:ramPrice')
  },
  wallet: {
    tokens: call('wallet:tokens'),
    addedTokens: call('wallet:addedTokens'),
    addToken: call('wallet:addToken'),
    removeToken: call('wallet:removeToken')
  },
  networkInfo: {
    overview: call('networkInfo:overview'),
    head: call('networkInfo:head')
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
    importVault: call('keys:importVault'),
    backup: call('keys:backup'),
    forgot: call('keys:forgot'),
    changePassword: call('keys:changePassword'),
    newRecoveryCode: call('keys:newRecoveryCode'),
    removeRecoveryCode: call('keys:removeRecoveryCode')
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
  faucet: {
    create: call('faucet:create'),
    tokens: call('faucet:tokens'),
    suggestName: call('faucet:suggestName')
  },
  accounts: {
    create: call('accounts:create'),
    changeKey: call('accounts:changeKey'),
    clearCode: call('accounts:clearCode'),
    pickList: call('accounts:pickList')
  },
  toolchains: {
    list: call('toolchains:list'),
    chooseFile: call('toolchains:chooseFile'),
    add: call('toolchains:add'),
    remove: call('toolchains:remove')
  },
  build: {
    run: call('build:run'),
    ensure: call('build:ensure'),
    rebuild: call('build:rebuild'),
    defaultCommand: call('build:defaultCommand')
  },
  ricardian: {
    create: call('ricardian:create')
  },
  docs: {
    read: call('docs:read')
  },
  on(event: string, cb: (...args: never[]) => void): () => void {
    return subscribe(EVENTS, event, cb)
  }
} as WaxApi

if (exposed === 'terminal') contextBridge.exposeInMainWorld('waxTerminal', terminalApi)
else if (exposed === 'editor') contextBridge.exposeInMainWorld('wax', api)
