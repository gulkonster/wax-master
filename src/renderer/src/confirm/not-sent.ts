// The line the confirmation window adds under the transaction when it was not
// sent: the window keeps what it showed; only "Nothing to confirm." is a bare page.

/** Longest text of the node shown in the line. */
export const NOT_SENT_MAX = 300

/** Text as one line of at most `max` characters. */
export function oneLine(text: string, max = NOT_SENT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** "Not sent. The node refused the transaction: ..." for a node's refusal; "Not sent: ..." for any other failure. */
export function notSentText(error: string | undefined, refused: boolean): string {
  const why = oneLine(error || 'Failed')
  return refused ? `Not sent. The node refused the transaction: ${why}` : `Not sent: ${why}`
}

/** What the confirmation page shows: the bare page only when there was nothing to load. */
export function confirmPageKind(loadError: string, loaded: boolean): 'bare' | 'loading' | 'transaction' {
  if (loadError) return 'bare'
  return loaded ? 'transaction' : 'loading'
}
