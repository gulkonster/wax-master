// Which account the Deploy dialog opens with, and the last account picked in it.

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
