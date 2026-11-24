// IPC handlers for the editor window and its terminal frame. Each handler
// checks the sender and validates every argument before acting.

import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import type { AppInfo, Settings } from '../shared/api'
import { bool, int, localAbsPath, obj, oneOf, relPath, str } from '../shared/validate'
import { normalizeConfig, type TemplateId } from '../shared/project'
import { BUILD_COMMIT, BUILD_STAGE, MAINNET_SIGNING } from './build-info'
import { log } from './log'
import * as projects from './projects'
import { isAllowedOrigin, isTerminalFrameUrl, openExternalConfirmed } from './security'
import * as store from './store'
import * as toolchain from './toolchain'
import * as terminal from './terminal'
import { wasmInfo } from './wasm-info'
import { runBuild, defaultBuildArgs } from './build'
import { optStr } from '../shared/validate'
import { run as runHelper } from './helper'
import { join, resolve } from 'node:path'

type Handler = (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function isEditorPageUrl(url: string): boolean {
  if (!isAllowedOrigin(url)) return false
  const path = new URL(url).pathname
  return !path.endsWith('/confirm.html') && !path.endsWith('/terminal.html')
}

/** Only the main editor page may call these handlers (not the confirmation page, not a sub frame). */
function fromMainPage(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  if (e.senderFrame !== e.sender.mainFrame) return false
  return isEditorPageUrl(url)
}

/**
 * Only the terminal page (app://terminal/terminal.html), embedded directly in
 * the editor page, may call the terminal and clipboard handlers.
 */
function fromTerminalFrame(e: IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  const main = e.sender?.mainFrame
  if (!frame || !main || frame === main) return false
  if (!isTerminalFrameUrl(frame.url)) return false
  if (frame.parent !== main) return false
  return isEditorPageUrl(main.url)
}

function guarded(channel: string, allowed: (e: IpcMainInvokeEvent) => boolean, fn: Handler): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!allowed(e)) throw new Error('Refused')
    try {
      return await fn(e, ...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`${channel} failed: ${msg}`)
      throw new Error(msg)
    }
  })
}

/** Terminal and clipboard calls: accepted only from the terminal frame. */
function handleTerminal(channel: string, fn: Handler): void {
  guarded(channel, fromTerminalFrame, fn)
}

/** Editor calls: accepted only from the main frame of the editor page. */
export function handle(channel: string, fn: Handler): void {
  guarded(channel, fromMainPage, fn)
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  handle('app:info', (): AppInfo => ({
    name: 'WAX Master',
    version: app.getVersion(),
    commit: BUILD_COMMIT,
    stage: BUILD_STAGE,
    mainnetSigning: MAINNET_SIGNING,
    platform: `${process.platform} ${process.arch}`
  }))
  handle('app:openExternal', (_e, url) => openExternalConfirmed(getWindow(), str(url, 'url', 2048)))

  handle('settings:get', () => store.getSettings())
  handle('settings:set', (_e, patchRaw) => {
    const p = obj(patchRaw, 'settings')
    const patch: Partial<Settings> = {}
    if ('fontSize' in p) patch.fontSize = int(p.fontSize, 'fontSize', 8, 40)
    if ('defaultProjectFolder' in p) patch.defaultProjectFolder = resolve(localAbsPath(p.defaultProjectFolder, 'defaultProjectFolder'))
    if ('autoLockMinutes' in p) {
      const v = int(p.autoLockMinutes, 'autoLockMinutes', 5, 60)
      if (v !== 5 && v !== 15 && v !== 60) throw new Error('autoLockMinutes: 5, 15 or 60')
      patch.autoLockMinutes = v
    }
    if ('lockAfterSignature' in p) patch.lockAfterSignature = bool(p.lockAfterSignature, 'lockAfterSignature')
    if ('updateCheck' in p) patch.updateCheck = bool(p.updateCheck, 'updateCheck')
    if ('terminalProfile' in p) patch.terminalProfile = oneOf(p.terminalProfile, 'terminalProfile', ['powershell', 'cmd', 'toolchain'] as const)
    if ('setupDismissed' in p) patch.setupDismissed = bool(p.setupDismissed, 'setupDismissed')
    return store.updateSettings(patch)
  })

  handle('projects:list', () => store.listProjects())
  handle('projects:create', (_e, template, name, parent) => {
    const t = oneOf(template, 'template', ['empty', 'hello', 'token'] as const) as TemplateId
    const dir = resolve(localAbsPath(parent, 'parent'))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return projects.createProject(t, str(name, 'name', 12), dir)
  })
  handle('projects:chooseParentFolder', async (_e, currentDir) => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose the folder for the new project',
      defaultPath: str(currentDir, 'current', 1024) || undefined,
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  handle('projects:openDialog', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Open a contract project folder',
      defaultPath: store.getSettings().defaultProjectFolder,
      properties: ['openDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return projects.openProject(r.filePaths[0])
  })
  handle('projects:open', (_e, path) => {
    const p = str(path, 'path', 1024)
    // Only projects already in the list can be opened by path; new ones go through the dialog.
    if (!store.findProject(p)) throw new Error('Unknown project; use Open Project')
    return projects.openProject(p)
  })
  handle('projects:setMainFile', (_e, main) => projects.setMainFile(relPath(main, 'main')))
  handle('projects:saveConfig', (_e, cfg) => {
    const c = obj(cfg, 'config')
    const normalized = normalizeConfig(c, '')
    relPath(normalized.main, 'main')
    if (normalized.include) relPath(normalized.include, 'include')
    if (normalized.resource) relPath(normalized.resource, 'resource')
    if (normalized.output) relPath(normalized.output, 'output')
    str(normalized.buildCommand, 'buildCommand', 4000)
    return projects.saveConfig(normalized)
  })
  handle('projects:star', (_e, path, starred) => store.setStar(str(path, 'path', 1024), bool(starred, 'starred')))
  handle('projects:remove', (_e, path) => store.removeProject(str(path, 'path', 1024)))
  handle('projects:close', () => projects.closeProject())

  handle('files:tree', () => projects.projectTree())
  handle('files:read', (_e, rel) => projects.readProjectFile(relPath(rel, 'path')))
  handle('files:write', async (e, rel, content) => {
    const stamp = await projects.writeProjectFile(relPath(rel, 'path'), str(content, 'content', 20 * 1024 * 1024))
    e.sender.send('files-changed')
    return stamp
  })
  handle('files:stat', (_e, rel) => projects.statProjectFile(relPath(rel, 'path')))
  handle('files:create', async (e, rel, dir) => {
    await projects.createEntry(relPath(rel, 'path'), bool(dir, 'dir'))
    e.sender.send('files-changed')
  })
  handle('files:rename', async (e, from, to) => {
    await projects.renameEntry(relPath(from, 'from'), relPath(to, 'to'))
    e.sender.send('files-changed')
  })
  handle('files:remove', async (e, rel) => {
    const abs = await projects.removeEntry(relPath(rel, 'path'))
    const win = getWindow()
    const opts = {
      type: 'warning' as const,
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete',
      message: `Move "${rel}" to the Recycle Bin?`
    }
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 0) return
    await shell.trashItem(abs)
    e.sender.send('files-changed')
  })
  handle('files:wasmInfo', async (_e, rel) => {
    const r = relPath(rel, 'path')
    if (!r.toLowerCase().endsWith('.wasm')) throw new Error('Not a .wasm file')
    return wasmInfo(await projects.readProjectBytes(r))
  })
  handle('files:reveal', (_e, rel) => {
    shell.showItemInFolder(projects.resolveInProject(relPath(rel, 'path')))
  })
  handle('files:saveAs', async (e, content, suggested) => {
    const text = str(content, 'content', 20 * 1024 * 1024)
    const cur = projects.currentProject()
    const win = getWindow()
    const opts: Electron.SaveDialogOptions = {
      title: 'Save As',
      defaultPath: cur ? projects.resolveInProject(relPath(suggested || 'untitled.cpp', 'suggested')) : undefined
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const rel = projects.relIfInProject(r.filePath)
    if (rel !== null) {
      await projects.writeProjectFile(rel, text)
      e.sender.send('files-changed')
      return { rel }
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(r.filePath, text, 'utf8')
    return { external: projects.registerExternal(r.filePath) }
  })
  handle('files:openDialog', async () => {
    const win = getWindow()
    const cur = projects.currentProject()
    const opts: Electron.OpenDialogOptions = {
      title: 'Open File',
      defaultPath: cur?.root,
      properties: ['openFile']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const p = r.filePaths[0]
    const rel = projects.relIfInProject(p)
    if (rel !== null) return { rel }
    return { external: projects.registerExternal(p) }
  })
  handle('files:writeExternal', (_e, token, content) =>
    projects.writeExternal(str(token, 'token', 64), str(content, 'content', 20 * 1024 * 1024))
  )

  let setupBusy = false
  const guardSetup = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (setupBusy) throw new Error('Setup is already running')
    setupBusy = true
    try {
      return await fn()
    } finally {
      setupBusy = false
    }
  }
  handle('toolchain:status', () => toolchain.status())
  handle('toolchain:enableWsl', (_e, compat) =>
    guardSetup(async () => {
      const r = await toolchain.enableWsl(bool(compat, 'compat'))
      return r.code === 0
        ? { ok: true, message: 'WSL was enabled. Windows needs a restart before the toolchain can be installed.' }
        : { ok: false, message: `Enabling WSL did not finish (exit ${r.code}). If you declined the administrator prompt, try again.` }
    })
  )
  handle('toolchain:install', (e, v) =>
    guardSetup(async () => {
      const version = int(v, 'wslVersion', 1, 2) as 1 | 2
      const progress = (line: string): void => {
        if (!e.sender.isDestroyed()) e.sender.send('setup-progress', line)
      }
      await toolchain.install({ wslVersion: version, progress })
      try {
        await toolchain.testBuild(progress)
      } catch (err) {
        progress(err instanceof Error ? err.message : String(err))
      }
      return toolchain.status()
    })
  )
  handle('toolchain:testBuild', (e) =>
    guardSetup(async () => {
      await toolchain.testBuild((line) => !e.sender.isDestroyed() && e.sender.send('setup-progress', line))
      return toolchain.status()
    })
  )
  handle('toolchain:restartComputer', async () => {
    const win = getWindow()
    const opts = {
      type: 'question' as const,
      buttons: ['Restart now', 'Later'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restart',
      message: 'Restart Windows now? Save your work in other programs first.'
    }
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 0) return
    await runHelper(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'shutdown.exe'), ['/r', '/t', '5'])
  })

  handle('build:run', (e) => runBuild(e.sender))

  // Terminal and clipboard: only the terminal frame (app://terminal) may call these.
  handleTerminal('clipboard:writeText', (_e, text) => clipboard.writeText(str(text, 'text', 1024 * 1024)))
  handleTerminal('clipboard:readText', async () => String(await clipboard.readText()).slice(0, 1024 * 1024))
  handleTerminal('terminal:profiles', () => ({ profiles: terminal.profiles(), gitHint: terminal.gitHint() }))
  handleTerminal('terminal:create', (e, profile, rel, cols, rows) =>
    terminal.createTerminal(
      e.senderFrame!,
      oneOf(profile, 'profile', ['powershell', 'cmd', 'toolchain'] as const),
      rel === null || rel === undefined || rel === '' ? null : relPath(rel, 'path'),
      int(cols, 'cols', 2, 1000),
      int(rows, 'rows', 2, 500)
    )
  )
  handleTerminal('terminal:write', (_e, id, data) => terminal.writeTerminal(str(id, 'id', 64), str(data, 'data', 1024 * 1024)))
  handleTerminal('terminal:resize', (_e, id, cols, rows) =>
    terminal.resizeTerminal(str(id, 'id', 64), int(cols, 'cols', 2, 1000), int(rows, 'rows', 2, 500))
  )
  handleTerminal('terminal:kill', (_e, id) => terminal.killTerminal(str(id, 'id', 64)))
  handle('build:defaultCommand', () => defaultBuildArgs().join(' '))
}
