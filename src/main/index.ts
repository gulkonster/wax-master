import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { buildMenu } from './menu'
import { registerIpc } from './ipc'
import { log, setLogSink } from './log'
import { appendFileSync, mkdirSync } from 'node:fs'
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
  setLogSink((line) => {
    appendFileSync(file, line + '\n')
    if (!app.isPackaged) process.stdout.write(line + '\n')
  })
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
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'WAX Master',
    backgroundColor: '#1e1e1e',
    icon: iconPath(),
    webPreferences: secureWebPreferences(join(__dirname, '../preload/index.js'))
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => log.error(`Page failed to load: ${code} ${desc}`))
  mainWindow.webContents.on('did-finish-load', () => log.info('Main page loaded'))
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
  nativeTheme.themeSource = 'dark'
  hardenSessions()
  registerAppProtocol()
  registerIpc(() => mainWindow)
  Menu.setApplicationMenu(
    buildMenu(
      () => mainWindow,
      (url) => void openExternalConfirmed(mainWindow, url),
      () => app.quit()
    )
  )
  createMainWindow()
  log.info(`WAX Master ${app.getVersion()} started`)
})

app.on('window-all-closed', () => {
  app.quit()
})
