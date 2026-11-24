// The text of the confirmation's Approve button. Approve opens only after the
// window has been visible and focused for a moment (checked here and again in
// the main process); while the window is not focused that wait does not run, so
// the button says what it waits for instead of showing a countdown that stands
// still.

export interface ApproveState {
  sending: boolean
  /** The wait is over. */
  armed: boolean
  /** The window is visible and focused (the wait runs). */
  focused: boolean
  waitMs: number
  expired: boolean
  blocked: boolean
}

export const APPROVE_UNFOCUSED = 'Approve and send (click this window first)'

export function approveLabel(s: ApproveState): string {
  if (s.sending) return 'Signing and sending...'
  if (s.armed || s.expired || s.blocked) return 'Approve and send'
  if (!s.focused) return APPROVE_UNFOCUSED
  return `Approve and send (in ${(s.waitMs / 1000).toFixed(1)} s)`
}
