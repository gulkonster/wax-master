import { emit } from './bus'

export type ToastKind = 'info' | 'success' | 'error'

export function toast(title: string, text = '', kind: ToastKind = 'info'): void {
  emit('toast', { title, text, kind })
}

export function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Strip Electron's IPC prefix so the user sees only the reason.
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
