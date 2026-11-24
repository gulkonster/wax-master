import { app } from 'electron'
import { join } from 'node:path'

/** %APPDATA%\WAX Master: settings, networks, stars, history, vault. */
export function dataDir(): string {
  return app.getPath('userData')
}

/** %LOCALAPPDATA%\WAX Master: toolchain distributions. */
export function localDataDir(): string {
  const local = process.env.LOCALAPPDATA || app.getPath('userData')
  return join(local, 'WAX Master')
}

export function defaultProjectsDir(): string {
  return join(app.getPath('documents'), 'WAX Master')
}

/** Folder with bundled read-only resources (project templates; the toolchain setup script is compiled into the app). */
export function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

/** The window and taskbar icon. */
export function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'build', 'icon.ico')
}
