// Settings-related calls: update check and Clear All App Data.

import { app, type BrowserWindow } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { bool, str } from '../shared/validate'
import { handle } from './ipc'
import { dataDir } from './paths'
import { checkForUpdates, dailyCheck } from './updates'
import { installedToolchains, remove as removeToolchain } from './toolchain'
import { vault } from './keys-service'
import { log } from './log'

export const VAULT_DELETE_WORDS = 'delete my keys'

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
    for (const t of installedToolchains()) {
      try {
        await removeToolchain(t.id)
      } catch (err) {
        log.warn(`Could not remove toolchain ${t.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    vault().lock()
    for (const f of ['settings.json', 'networks.json', 'contract-history.json']) rmSync(join(dataDir(), f), { force: true })
    if (withVault) rmSync(join(dataDir(), 'vault.json'), { force: true })
    log.info(`App data cleared${withVault ? ' including the vault' : ''}`)
    app.relaunch()
    app.exit(0)
  })
}
