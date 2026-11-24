// Which engine diagnostics the editor shows. The engine parses contract code
// with a stock compiler front end set up to look like the wasm32 target; a few
// diagnostics come from that difference, not from the user's code, and are
// dropped here (the build output stays the final word on errors).

export type FlagSetup = 'x32' | 'i386'

/** The target setup the editor engine uses (see src/main/compile-commands.ts). */
export const FLAG_SETUP: FlagSetup = 'x32'

export interface LspPosition {
  line: number
  character: number
}
export interface LspRange {
  start: LspPosition
  end: LspPosition
}
export interface LspDiagnostic {
  range: LspRange
  severity?: number
  code?: string | number
  source?: string
  message: string
  relatedInformation?: { location: { uri: string; range: LspRange }; message: string }[]
  tags?: number[]
}

/** Dropped only when they come from a toolchain header. */
const HEADER_ONLY_CODES = new Set(['static_assert_requirement_failed', 'typecheck_assign_const'])

function isToolchainUri(uri: string): boolean {
  return uri.startsWith('toolchain:')
}

/** True when the diagnostic was raised inside a toolchain header ("In included file" reports included). */
export function fromToolchainHeader(d: LspDiagnostic, docUri: string): boolean {
  if (isToolchainUri(docUri)) return true
  if (!/^in included file/i.test(d.message)) return false
  return (d.relatedInformation ?? []).some((r) => isToolchainUri(r.location.uri))
}

export function keepDiagnostic(d: LspDiagnostic, docUri: string, setup: FlagSetup): boolean {
  const code = typeof d.code === 'string' ? d.code : ''
  if (setup === 'i386' && code === 'type_unsupported') return false
  if (HEADER_ONLY_CODES.has(code) && fromToolchainHeader(d, docUri)) return false
  return true
}

export function filterDiagnostics(list: LspDiagnostic[], docUri: string, setup: FlagSetup): LspDiagnostic[] {
  return list.filter((d) => keepDiagnostic(d, docUri, setup))
}
