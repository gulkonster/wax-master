// Deploy with automatic build off (E69): which files it sends, in one line.

import type { BuildStatus, BuildVariant } from '../../../shared/api'

function label(v: BuildVariant): string {
  return v === 'any' ? 'one build for every network' : v === 'mainnet' ? 'mainnet build' : 'testnet build'
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** What Deploy sends when it does not build by itself; `fits` false says Rebuild is needed. */
export function filesOnDiskLine(s: BuildStatus): { text: string; fits: boolean } {
  if (s.builtAt === null || s.variant === null) {
    return s.takes === 'any'
      ? { text: 'Sends the WASM and ABI on disk; WAX Master has not built this project.', fits: true }
      : { text: `WAX Master has not built this project, so the files on disk may not be the ${label(s.takes)}. Press Rebuild.`, fits: false }
  }
  if (s.result === 'failed') return { text: 'The last build failed. Press Rebuild.', fits: false }
  if (!s.filesMatch) {
    return s.takes === 'any' && s.variant === 'any'
      ? { text: 'Sends the WASM and ABI on disk; they changed after the last build here.', fits: true }
      : { text: `The files on disk changed after the last build here, so they may not be the ${label(s.takes)}. Press Rebuild.`, fits: false }
  }
  const fits = s.variant === 'any' || s.variant === s.takes
  if (!fits) return { text: `The files on disk are the ${label(s.variant)}; this network takes the ${label(s.takes)}. Press Rebuild.`, fits: false }
  const changed = s.changed ? ' The project changed since then: press Rebuild to send the changes.' : ''
  return { text: `Sends the ${label(s.variant)} from ${clock(s.builtAt)}.${changed}`, fits: true }
}
