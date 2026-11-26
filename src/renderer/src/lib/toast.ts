import { emit } from './bus'
import { isUnlockCancelled, withoutLockedCode } from '../../../shared/vault-locked'

export type ToastKind = 'info' | 'success' | 'error' | 'progress'

/** How long a notice stays (ms); 0 = until it is replaced or closed (E60). */
export const TOAST_MS: Record<ToastKind, number> = { info: 5000, success: 5000, error: 15000, progress: 0 }

/** A notice at the top of the window. With `key`, it replaces the notice with the same key. */
export function toast(title: string, text = '', kind: ToastKind = 'info', key?: string): void {
  emit('toast', { title, text, kind, key })
}

/** The reason of an error as the user reads it; empty when the user cancelled the unlock prompt. */
export function errorText(err: unknown): string {
  if (isUnlockCancelled(err)) return ''
  const m = err instanceof Error ? err.message : String(err)
  // Strip Electron's IPC prefix so the user sees only the reason.
  return withoutLockedCode(m.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}
