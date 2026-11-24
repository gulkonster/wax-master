// The line the confirmation window adds under the transaction when it was not
// sent: the window keeps what it showed; only "Nothing to confirm." is a bare page.

/** Longest text of the node shown in the line. */
export const NOT_SENT_MAX = 300

/** Text as one line of at most `max` characters. */
export function oneLine(text: string, max = NOT_SENT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * How the send failed, as the main process tells it: the node answered with an
 * error, the transaction may have reached the node (no answer, or the node
 * already has it), or it failed before anything was sent.
 */
export type SendFailure = 'refused' | 'unknown' | 'not-sent'

/** Longest text of a "may have arrived" message: it names the transaction id and must not lose its advice. */
const UNKNOWN_MAX = 600

/**
 * "Not sent. The node refused the transaction: ..." for a node's refusal; the
 * message alone when the transaction may have arrived; "Not sent: ..." when it
 * failed before sending.
 */
export function notSentText(error: string | undefined, failure: SendFailure): string {
  if (failure === 'unknown') return oneLine(error || 'No answer from the node.', UNKNOWN_MAX)
  const why = oneLine(error || 'Failed')
  return failure === 'refused' ? `Not sent. The node refused the transaction: ${why}` : `Not sent: ${why}`
}

/** What the confirmation page shows: the bare page only when there was nothing to load. */
export function confirmPageKind(loadError: string, loaded: boolean): 'bare' | 'loading' | 'transaction' {
  if (loadError) return 'bare'
  return loaded ? 'transaction' : 'loading'
}
