// The text of the confirmation's Approve button. It works at once (E65): no wait and no typed name.

export function approveLabel(sending: boolean): string {
  return sending ? 'Signing and sending...' : 'Approve and send'
}
