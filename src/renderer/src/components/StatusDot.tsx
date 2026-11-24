// The status mark of a network: a dot (green, orange, red) or a hollow grey
// ring while checking. The text label and the tooltip carry the meaning too.

import type { NetworkStatus } from '../../../shared/chain-types'

export function StatusDot({ status }: { status: NetworkStatus | null }): React.JSX.Element {
  const level = status?.level ?? 'checking'
  const title = status?.summary || 'Checking'
  return <span className={`status-dot ${level}`} role="img" aria-label={status?.label ?? 'Checking'} title={title} />
}
