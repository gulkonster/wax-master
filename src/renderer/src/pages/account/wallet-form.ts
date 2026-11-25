// State rules shared by the wallet forms: what an amount field says, the state
// of a form after a sent transaction, and the reads that follow a send.

import { amountUnits, COMMA_TEXT } from '../../../../shared/wallet'

/** An amount field: its text and whether it was left (or its form's button pressed). */
export interface AmountField {
  text: string
  touched: boolean
}

/** A form's amount after a sent transaction: empty and untouched, so nothing is red. */
export const CLEARED_FIELD: AmountField = { text: '', touched: false }

/**
 * The note under an amount field ('' when there is nothing to say). Nothing is
 * said before the field was left or the button pressed. A comma always gets its
 * own text: it is never read as a decimal point or removed. `required`: the
 * field alone must hold an amount above zero.
 */
export function amountNote(f: AmountField, precision: number, required: boolean): string {
  if (!f.touched) return ''
  const t = f.text.trim()
  if (t.includes(',')) return COMMA_TEXT
  if (t === '' && !required) return ''
  const u = amountUnits(t, precision)
  if (u === null || (required && u <= 0n)) return `Enter an amount above zero with at most ${precision} decimals.`
  return ''
}

/**
 * The text of a refund's time. On the WAX chains the waiting time is known and
 * the time is exact; elsewhere it is the standard time of the system contract,
 * said as "about".
 */
export function refundTimeText(exact: boolean, due: boolean, dueText: string, requestedText: string): string {
  if (exact) return due ? 'Can be claimed now.' : `Can be claimed from ${dueText}.`
  return `About 3 days after the unstake (${requestedText}), if this chain uses the standard waiting time.`
}

/**
 * The line under Weight of Add key / Add account. Adding an entry keeps the
 * permission's threshold, so it is said with that threshold and the typed weight.
 */
export function addEntryWeightHint(permission: string, threshold: number | undefined, weight: number): string {
  if (threshold === undefined) return `The threshold of ${permission} is not read yet.`
  const head = `The threshold of ${permission} is ${threshold} and stays as it is.`
  if (!Number.isInteger(weight) || weight < 1) return `${head} Enter a weight of 1 or more.`
  return weight >= threshold
    ? `${head} With weight ${weight} the new entry can sign alone.`
    : `${head} With weight ${weight} the new entry cannot sign alone: with the other signers the weights must add up to ${threshold}.`
}

/** Whether Claim refund is disabled by the time: only on the WAX chains, until the chain's time reaches the due time. */
export function refundBlocked(exact: boolean, secondsLeft: number, secondsSinceRead: number): boolean {
  return exact && secondsSinceRead < secondsLeft
}

/**
 * When the account is read again after a sent transaction: at once, after 1.5 s
 * and after 4 s. A read right after the node's answer can still see the block
 * before the one that holds the transaction.
 */
export const AFTER_SEND_READS_MS: readonly number[] = [0, 1500, 4000]

/**
 * When the page of an account created a moment ago reads it again while the
 * node does not have it yet (after the first failed read, then each next one).
 */
export const NEW_ACCOUNT_READS_MS: readonly number[] = [1500, 2500, 4000, 6000]

/** What the page says while it waits for a new account to be readable. */
export const NEW_ACCOUNT_WAIT_TEXT = 'The new account is not readable yet; reading again...'

/** Accounts created here whose page has not read them yet, with the reads tried again so far. */
const newAccounts = new Map<string, number>()

/** Marks an account created a moment ago: its page reads it again a few times before it shows a failed read. */
export function markNewAccount(name: string): void {
  newAccounts.set(name, 0)
}

/** The account was read: it is no longer waited for. */
export function newAccountRead(name: string): void {
  newAccounts.delete(name)
}

/** After a failed read: the wait before the next read of a new account, or null to show the failure. */
export function nextNewAccountRead(name: string): number | null {
  const tried = newAccounts.get(name)
  if (tried === undefined) return null
  if (tried >= NEW_ACCOUNT_READS_MS.length) {
    newAccounts.delete(name)
    return null
  }
  newAccounts.set(name, tried + 1)
  return NEW_ACCOUNT_READS_MS[tried]
}

/**
 * Starts the reads that follow a sent transaction: `read` at each time of
 * AFTER_SEND_READS_MS, `readLast` with the last one. Returns the function that
 * stops the ones not yet done.
 */
export function scheduleReadsAfterSend(
  setTimer: (fn: () => void, ms: number) => unknown,
  clearTimer: (t: unknown) => void,
  read: () => void,
  readLast: () => void
): () => void {
  const last = AFTER_SEND_READS_MS.length - 1
  const timers = AFTER_SEND_READS_MS.map((ms, i) =>
    setTimer(() => {
      read()
      if (i === last) readLast()
    }, ms)
  )
  return () => {
    for (const t of timers) clearTimer(t)
  }
}
