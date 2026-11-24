// The one typed answer to a key or signing request on a locked vault, and the
// rule the editor window follows with it: ask for the password in place, then
// repeat the request once.

/** Code at the start of the error message; it survives the IPC boundary as text. */
export const VAULT_LOCKED = 'vault-locked'

export const LOCKED_MESSAGE = `${VAULT_LOCKED}: The vault is locked. Unlock it to go on.`

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * True only for the typed locked-vault error itself: the message is exactly
 * `LOCKED_MESSAGE`, or ends with ": " + `LOCKED_MESSAGE` (Electron's prefix on the
 * way through IPC). The code inside any other text does not count.
 */
export function isVaultLocked(err: unknown): boolean {
  const m = messageOf(err)
  return m === LOCKED_MESSAGE || m.endsWith(`: ${LOCKED_MESSAGE}`)
}

/** Text of the locked-vault error without its code (for a message that reaches the user anyway). */
export function withoutLockedCode(text: string): string {
  return text.split(`${VAULT_LOCKED}: `).join('')
}

/**
 * The message an IPC handler passes on: the typed locked-vault error unchanged,
 * any other message with the code made inert, so text written by a node, a
 * service or a file can never ask for the password and repeat a request.
 */
export function neutralizeLockedCode(message: string): string {
  if (message === LOCKED_MESSAGE) return message
  return message.split(`${VAULT_LOCKED}:`).join('vault locked:')
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
