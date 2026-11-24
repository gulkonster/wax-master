// The line a signing form shows after its transaction: a cancel is a neutral
// note, never an error; a refusal is explained once, by the transaction's
// inspector when the form shows one, otherwise by the form's error line.

import type { TxOutcome } from '../../../shared/api'

export const CANCELLED_NOT_SIGNED = 'Cancelled; nothing was signed.'
export const CANCELLED_NOT_SENT = 'Cancelled; nothing was sent.'

export interface FormLine {
  kind: 'note' | 'error'
  text: string
}

/**
 * The form's own line for an outcome. A failed transaction whose inspector is
 * shown and carries the explanation gets no line of its own.
 */
export function outcomeLine(r: TxOutcome, cancelled: string, inspectorShown = true): FormLine | null {
  if (r.status === 'sent') return null
  if (r.status === 'cancelled') return { kind: 'note', text: cancelled }
  if (inspectorShown && r.trace?.errorMessage) return null
  return { kind: 'error', text: r.error }
}

/** Class of the element that shows a form line: the hint style for a note, the error style for an error. */
export function formLineClass(l: FormLine): string {
  return l.kind === 'error' ? 'error-text' : 'hint'
}
