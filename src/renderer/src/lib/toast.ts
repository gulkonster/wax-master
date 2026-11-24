import { emit } from './bus'
import { isUnlockCancelled, withoutLockedCode } from '../../../shared/vault-locked'

export type ToastKind = 'info' | 'success' | 'error'

export function toast(title: string, text = '', kind: ToastKind = 'info'): void {
  emit('toast', { title, text, kind })
}

/** The reason of an error as the user reads it; empty when the user cancelled the unlock prompt. */
export function errorText(err: unknown): string {
  if (isUnlockCancelled(err)) return ''
  const m = err instanceof Error ? err.message : String(err)
  // Strip Electron's IPC prefix so the user sees only the reason.
  return withoutLockedCode(m.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}
