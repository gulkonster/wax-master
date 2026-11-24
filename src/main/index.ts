import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { buildMenu, watchMenuKey } from './menu'
import { hasBlockedSwitch } from './switches'
import { registerIpc } from './ipc'
import { guardWindow, registerCloseGuard } from './close-guard'
import { registerChainIpc } from './ipc-chain'
import { registerKeys } from './keys-service'
import { registerTxIpc } from './ipc-tx'
import { registerAppIpc } from './ipc-app'
import { registerToolchainIpc } from './ipc-toolchains'
import { registerEditorIpc } from './ipc-editor'
import { stopEditor } from './clangd'
import { currentNetwork, endpointOf, listNetworks, onNetworksChanged, selectNetwork } from './networks'
import { killAllTerminals } from './terminal'
import { stopHelper } from './helper'
import { fileSink, log, setLogSink } from './log'
import { applyThemeSetting, followTheme, themeArgs, titleBarOverlay, windowBackground } from './theme'
import { getSettings } from './store'
import { mkdirSync } from 'node:fs'
import {
  APP_ORIGIN,
  hardenSessions,
  openExternalConfirmed,
  registerAppProtocol,
  registerSchemes,
  secureWebPreferences
} from './security'

process.on('uncaughtException', (err) => log.error('Uncaught error', err))
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err))

app.setName('WAX Master')

// Log to a file in the app data folder (messages are already redacted).
{
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'main.log')
  const toFile = fileSink(file)
  setLogSink((line) => {
    toFile(line)
    if (!app.isPackaged) process.stdout.write(line + '\n')
  })
}

// A packaged build never runs with debugging, inspector or security-weakening switches.
if (app.isPackaged && hasBlockedSwitch(process.argv, (s) => app.commandLine.hasSwitch(s))) {
  log.error('WAX Master did not start: a command line switch that is not allowed was given (debugging, inspector or security setting).')
  app.exit(1)
}

app.setAppUserModelId('io.github.gulkonster.waxmaster')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

registerSchemes()

let mainWindow: BrowserWindow | null = null

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'build', 'icon.ico')
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'WAX Master',
    backgroundColor: windowBackground('chrome'),
    // Windows draws the caption buttons; the page draws icon, menus and title in the same row.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    icon: iconPath(),
    webPreferences: secureWebPreferences(join(__dirname, '../preload/index.js'), themeArgs())
  })
  followTheme(mainWindow, 'chrome', true)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  guardWindow(mainWindow)
  watchMenuKey(mainWindow)
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) =>
    log.error(`${isMain ? 'Page' : 'Frame'} failed to load: ${code} ${desc} ${url.split(/[?#]/)[0]}`)
  )
  mainWindow.webContents.on('did-finish-load', () => log.info('Main page loaded'))
  mainWindow.webContents.on('did-frame-navigate', (_e, url, code, _text, isMain) => {
    if (!isMain) log.info(`Frame loaded: ${url.split(/[?#]/)[0]} (${code})`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) => log.error(`Window process ended: ${d.reason}`))
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  applyThemeSetting(getSettings().theme)
  hardenSessions()
  registerAppProtocol()
  registerIpc(() => mainWindow)
  registerCloseGuard(() => mainWindow)
  registerChainIpc(() => mainWindow)
  registerKeys(() => mainWindow)
  registerTxIpc(() => mainWindow)
  registerAppIpc(() => mainWindow)
  registerToolchainIpc(() => mainWindow)
  registerEditorIpc()
  const refreshMenu = (): void => {
    const cur = currentNetwork().id
    Menu.setApplicationMenu(
      buildMenu(
        () => mainWindow,
        (url) => void openExternalConfirmed(mainWindow, url),
        () => app.quit(),
        listNetworks().map((n) => ({ id: n.id, name: n.name, current: n.id === cur })),
        (id) => {
          const n = selectNetwork(id)
          mainWindow?.webContents.send('network-changed', n, `Switched to ${n.name} at ${endpointOf(n)}.`)
          refreshMenu()
        }
      )
    )
  }
  refreshMenu()
  onNetworksChanged(refreshMenu)
  createMainWindow()
  log.info(`WAX Master ${app.getVersion()} started`)
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  killAllTerminals()
  stopEditor('The app is closing.', true)
  setTimeout(stopHelper, 300)
})
