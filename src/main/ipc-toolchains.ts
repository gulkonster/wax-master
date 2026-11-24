// Toolchain manager: list, add a CDT package from a file, remove.

import { dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { int, str } from '../shared/validate'
import { handle } from './ipc'
import {
  DEFAULT_TOOLCHAIN,
  TOOLCHAINS,
  inspectCdtPackage,
  install,
  installedToolchains,
  remove,
  testBuild,
  type ExtraCdt
} from './toolchain'

// Files the user picked in the dialog, by token; the window never names a path.
const picked = new Map<string, ExtraCdt>()
let busy = false

export function registerToolchainIpc(getWindow: () => BrowserWindow | null): void {
  handle('toolchains:list', () => ({
    defaultId: DEFAULT_TOOLCHAIN,
    defaultLabel: TOOLCHAINS[0].label,
    installed: installedToolchains().map((t) => ({ ...t, isDefault: t.id === DEFAULT_TOOLCHAIN }))
  }))

  handle('toolchains:chooseFile', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Add a CDT package',
      properties: ['openFile'],
      filters: [{ name: 'CDT package', extensions: ['deb'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const info = await inspectCdtPackage(r.filePaths[0])
    const token = randomUUID()
    picked.set(token, info)
    return { token, id: info.id, label: info.label, sha256: info.sha256, size: info.size, known: info.known, file: r.filePaths[0] }
  })

  handle('toolchains:add', async (e, token, wslVersion) => {
    const extra = picked.get(str(token, 'token', 64))
    if (!extra) throw new Error('Choose the file again')
    if (busy) throw new Error('A toolchain is being installed')
    busy = true
    const progress = (line: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('setup-progress', line)
    }
    try {
      await install({ wslVersion: int(wslVersion, 'wslVersion', 1, 2) as 1 | 2, progress, extra })
      picked.delete(str(token, 'token', 64))
      await testBuild(progress, extra.id).catch((err) => progress(err instanceof Error ? err.message : String(err)))
      return installedToolchains()
    } finally {
      busy = false
    }
  })

  handle('toolchains:remove', async (_e, id) => {
    const tid = str(id, 'id', 80)
    if (tid === DEFAULT_TOOLCHAIN) throw new Error('The default toolchain is repaired, not removed (Setup > Repair toolchain)')
    await remove(tid)
    return installedToolchains()
  })
}
