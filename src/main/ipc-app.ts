// Settings-related calls: update check and Clear All App Data.

import { app, type BrowserWindow } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { bool, str } from '../shared/validate'
import { handle } from './ipc'
import { dataDir } from './paths'
import { NETWORKS_V1_BACKUP } from './networks'
import { checkForUpdates, dailyCheck } from './updates'
import { installedToolchains, remove as removeToolchain } from './toolchain'
import { confirmNative, vault } from './keys-service'
import { log } from './log'
import { keptVaultCopies } from './vault'

export const VAULT_DELETE_WORDS = 'delete my keys'

/** The vault file and every kept or half-written copy of it in the data folder that exists now. */
export function vaultFiles(dir: string): string[] {
  return ['vault.json', 'vault.json.tmp', ...keptVaultCopies(dir)].filter((n) => existsSync(join(dir, n)))
}

export function registerAppIpc(getWindow: () => BrowserWindow | null): void {
  handle('app:checkUpdates', () => checkForUpdates())
  setTimeout(() => {
    void dailyCheck((r) => getWindow()?.webContents.send('update-available', r)).catch(() => undefined)
  }, 5000)

  handle('app:clearData', async (_e, includeVault, typed) => {
    const withVault = bool(includeVault, 'includeVault')
    if (withVault && str(typed, 'typed', 100) !== VAULT_DELETE_WORDS) {
      throw new Error(`Type "${VAULT_DELETE_WORDS}" to delete the vault too`)
    }
    // Both questions are asked here, in the main process; the window cannot answer them.
    const toolchains = installedToolchains()
    const list = toolchains.length ? toolchains.map((t) => `  ${t.id}`).join('\n') : '  (none installed)'
    const win = getWindow()
    const first = await confirmNative(
      win,
      'Clear all app data?',
      `This removes:\n- settings, networks and saved history\n- the log files\n- the installed toolchains:\n${list}\n\nProjects are not touched. WAX Master restarts afterwards.`,
      'Clear data'
    )
    if (!first) return
    if (withVault) {
      let count = 0
      try {
        count = vault().list().length
      } catch {
        count = 0
      }
      const files = vaultFiles(dataDir())
      const names = (files.length ? files : ['vault.json']).map((n) => `  ${n}`).join('\n')
      const second = await confirmNative(
        win,
        'Delete the key vault too?',
        `Folder: ${dataDir()}\nFiles:\n${names}\nKeys in vault.json: ${count}\n\nThe private keys are lost unless you have an exported copy. The kept older vault files are deleted too.`,
        'Delete vault'
      )
      if (!second) return
    }
    for (const t of toolchains) {
      try {
        await removeToolchain(t.id)
      } catch (err) {
        log.warn(`Could not remove toolchain ${t.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    vault().lock()
    for (const f of ['settings.json', 'networks.json', NETWORKS_V1_BACKUP, 'contract-history.json']) rmSync(join(dataDir(), f), { force: true })
    if (withVault) for (const f of vaultFiles(dataDir())) rmSync(join(dataDir(), f), { force: true })
    log.info(`App data cleared${withVault ? ' including the vault' : ''}`)
    rmSync(join(dataDir(), 'logs'), { recursive: true, force: true })
    app.relaunch()
    app.exit(0)
  })
}
