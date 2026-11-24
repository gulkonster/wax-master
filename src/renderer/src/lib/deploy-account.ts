// Which account the Deploy dialog opens with, the last account picked in it,
// and the reads of the comparison after Buy RAM.

import { AFTER_SEND_READS_MS, scheduleReadsAfterSend } from '../pages/account/wallet-form'

/** The last account picked in the Deploy dialog, per project folder and network (kept for this session). */
const lastPicks = new Map<string, string>()

function key(projectPath: string, networkId: string): string {
  return `${projectPath}\u0000${networkId}`
}

export function lastDeployPick(projectPath: string, networkId: string): string | undefined {
  return lastPicks.get(key(projectPath, networkId))
}

export function rememberDeployPick(projectPath: string, networkId: string, account: string): void {
  lastPicks.set(key(projectPath, networkId), account)
}

/**
 * The project's saved deploy account for this network, else the account open
 * in the top bar, else the last account picked in the dialog; each only when it
 * is starred on this network. None of them: no account.
 */
export function preselectAccount(saved: string | undefined, current: string | null | undefined, last: string | undefined, stars: string[]): string {
  for (const a of [saved, current, last]) if (a && stars.includes(a)) return a
  return ''
}

/**
 * After Buy RAM in the Deploy dialog: the comparison is read at the times of the
 * reads after a send (AFTER_SEND_READS_MS), because a read right after the
 * purchase can still see the block before it. Stops at the first plan whose
 * ramAvailable differs from `before` and passes it to done with changed = true;
 * when none differs, passes the last plan read with changed = false once every
 * read has answered (fail when none could be read). Returns the function that
 * stops the reads; a read that answers after it is ignored.
 */
export function readPlanAfterRamPurchase<P extends { ramAvailable: number }>(
  before: number,
  read: () => Promise<P | null>,
  done: (plan: P | null, changed: boolean) => void,
  fail: (e: unknown) => void,
  setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
): () => void {
  let stopped = false
  let answered = 0
  let latest: P | null = null
  let error: unknown = null
  let cancel = (): void => {}
  const stop = (): void => {
    stopped = true
    cancel()
  }
  const settle = (): void => {
    if (++answered < AFTER_SEND_READS_MS.length) return
    stop()
    if (latest || error === null) done(latest, false)
    else fail(error)
  }
  const one = (): void => {
    read().then(
      (plan) => {
        if (stopped) return
        if (plan && plan.ramAvailable !== before) {
          stop()
          done(plan, true)
          return
        }
        if (plan) latest = plan
        settle()
      },
      (e: unknown) => {
        if (stopped) return
        error = e
        settle()
      }
    )
  }
  cancel = scheduleReadsAfterSend(setTimer, clearTimer, one, () => {})
  return stop
}
