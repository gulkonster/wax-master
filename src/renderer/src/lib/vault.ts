// Vault state shown in the status bar and the keys dialog.

import { Store } from './stores'

export interface VaultState {
  exists: boolean
  unlocked: boolean
  keys: number
}

export const vaultStore = new Store<VaultState>({ exists: false, unlocked: false, keys: 0 })

export async function refreshVault(): Promise<void> {
  vaultStore.set(await window.wax.keys.status())
}

export function watchVault(): () => void {
  return window.wax.on('vault-changed', (s: VaultState) => vaultStore.set(s))
}
