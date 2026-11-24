// The one typed answer to a key or signing request on a locked vault, and the
// rule the editor window follows with it: ask for the password in place, then
// repeat the request once.

/** Code at the start of the error message; it survives the IPC boundary as text. */
export const VAULT_LOCKED = 'vault-locked'

export const LOCKED_MESSAGE = `${VAULT_LOCKED}: The vault is locked. Unlock it to go on.`

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** True for the typed locked-vault error, also after Electron prefixed it on the way through IPC. */
export function isVaultLocked(err: unknown): boolean {
  return new RegExp(`(^|[\\s:])${VAULT_LOCKED}:`).test(messageOf(err))
}

/** Text of the locked-vault error without its code (for a message that reaches the user anyway). */
export function withoutLockedCode(text: string): string {
  return text.replace(`${VAULT_LOCKED}: `, '')
}

/** The user closed the unlock prompt; the operation did not run and nothing needs to be shown. */
export class UnlockCancelled extends Error {
  constructor() {
    super('Unlock cancelled')
    this.name = 'UnlockCancelled'
  }
}

export function isUnlockCancelled(err: unknown): boolean {
  return err instanceof UnlockCancelled
}

/**
 * Runs `run`; on the locked-vault error asks (`ask` resolves true once the vault is
 * unlocked, false when the user cancelled) and runs it once more. Any other error,
 * and an error of the second run, goes to the caller unchanged.
 */
export async function retryAfterUnlock<T>(run: () => Promise<T>, ask: () => Promise<boolean>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (!isVaultLocked(e)) throw e
    if (!(await ask())) throw new UnlockCancelled()
    return run()
  }
}
