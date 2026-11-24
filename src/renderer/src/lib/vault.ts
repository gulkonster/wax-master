// Vault state shown in the status bar and the keys dialog, and unlocking in
// place: an operation that needs keys runs through withVault, which asks for the
// password in the window the user is in and then repeats the operation once.

import { Store } from './stores'
import { retryAfterUnlock } from '../../../shared/vault-locked'
import type { VaultStatus } from '../../../shared/api'

export type VaultState = VaultStatus

export const vaultStore = new Store<VaultState>({ exists: false, unlocked: false, keys: 0, noBackup: 0, recovery: false })

export async function refreshVault(): Promise<void> {
  vaultStore.set(await window.wax.keys.status())
}

export function watchVault(): () => void {
  return window.wax.on('vault-changed', (s: VaultState) => vaultStore.set(s))
}

/** An open unlock prompt; `done(true)` once the vault is unlocked (or created), `done(false)` on Cancel. */
export interface UnlockRequest {
  done: (unlocked: boolean) => void
}

/** Read by the one UnlockPrompt host of the window. */
export const unlockPromptStore = new Store<UnlockRequest | null>(null)

let asking: Promise<boolean> | null = null

/**
 * Opens the unlock prompt (or "Create the vault" when there is none) over the
 * current window. Requests that arrive while it is open share it.
 */
export function askUnlock(): Promise<boolean> {
  if (asking) return asking
  asking = new Promise<boolean>((resolve) => {
    unlockPromptStore.set({
      done: (unlocked) => {
        unlockPromptStore.set(null)
        asking = null
        resolve(unlocked)
      }
    })
  })
  return asking
}

/**
 * Runs an operation that needs the vault's keys. When the main process answers
 * with the typed locked-vault error, the prompt asks for the password and the
 * operation runs once more; Cancel rejects with UnlockCancelled (show nothing).
 */
export function withVault<T>(run: () => Promise<T>): Promise<T> {
  return retryAfterUnlock(run, askUnlock)
}
