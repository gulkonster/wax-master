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
  /**
   * Fixes the engine sends with the diagnostic (`codeActionsInline`). A client that announces
   * `workspaceEdit.documentChanges`, as the window does, gets the edits in `documentChanges`.
   */
  codeActions?: {
    title: string
    edit?: {
      changes?: Record<string, { range: LspRange; newText: string }[]>
      documentChanges?: { textDocument: { uri: string }; edits: { range: LspRange; newText: string }[] }[]
    }
  }[]
}

/** The toolchain version whose attribute list is known. */
const ATTRIBUTE_CDT_VERSION = '4.1.1wax01'

/** The `eosio::` attributes the 4.1.1wax01 compiler knows. */
export const KNOWN_EOSIO_ATTRIBUTES: readonly string[] = [
  'action',
  'table',
  'contract',
  'on_notify',
  'read_only',
  'ricardian',
  'wasm_import',
  'wasm_entry',
  'wasm_abi',
  'wasm_action',
  'wasm_notify',
  'ignore'
]

/** The name after `eosio::` when the underlined text is an eosio attribute, else null. */
function eosioAttributeName(underlined: string): string | null {
  const m = /^eosio::(\w+)/.exec(underlined.trim())
  return m ? m[1] : null
}

/**
 * The attribute name in the engine's words ("Unknown attribute 'action' ignored"), without
 * a leading `eosio::`; null when the words do not name one.
 */
function messageAttributeName(message: string): string | null {
  const m = /unknown attribute '(?:eosio::)?(\w+)'/i.exec(message)
  return m ? m[1] : null
}

/**
 * True when the underlined text is a macro name (one identifier, not the attribute itself),
 * as with `ACTION`, `TABLE`, `CONTRACT` or `EOSIO_DISPATCH`: the attribute is in the macro.
 */
function isMacroName(underlined: string, attribute: string): boolean {
  const t = underlined.trim()
  return /^[A-Za-z_]\w*$/.test(t) && t !== attribute
}

function isUnknownAttribute(d: LspDiagnostic): boolean {
  return d.code === 'unknown-attributes' || /^unknown attribute '[^']*' ignored/i.test(d.message)
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** The known attribute nearest to `name` by edit distance, at most 2; null when none. */
function nearestAttribute(name: string): string | null {
  let best: string | null = null
  let bestDistance = 3
  for (const k of KNOWN_EOSIO_ATTRIBUTES) {
    const d = editDistance(name, k)
    if (d < bestDistance) {
      best = k
      bestDistance = d
    }
  }
  return best
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

export interface DiagnosticContext {
  cdtVersion: string
  /** The text the diagnostic's range covers. */
  underlined: string
}

export function keepDiagnostic(d: LspDiagnostic, docUri: string, setup: FlagSetup, ctx?: DiagnosticContext): boolean {
  const code = typeof d.code === 'string' ? d.code : ''
  if (setup === 'i386' && code === 'type_unsupported') return false
  if (HEADER_ONLY_CODES.has(code) && fromToolchainHeader(d, docUri)) return false
  if (ctx && isUnknownAttribute(d)) {
    const name = eosioAttributeName(ctx.underlined)
    if (name !== null) {
      // Known to the compiler: no warning. Unknown: shown only where the attribute list is known.
      if (KNOWN_EOSIO_ATTRIBUTES.includes(name)) return false
      if (ctx.cdtVersion !== ATTRIBUTE_CDT_VERSION) return false
    } else {
      // Written through a macro: the underline is on the macro name, the attribute is in the words.
      const inMessage = messageAttributeName(d.message)
      if (inMessage !== null && KNOWN_EOSIO_ATTRIBUTES.includes(inMessage) && isMacroName(ctx.underlined, inMessage)) return false
    }
  }
  return true
}

/** Words and severity of the diagnostics that are kept: unknown eosio attribute, unused include. */
export function rewriteDiagnostic(d: LspDiagnostic, ctx: DiagnosticContext): LspDiagnostic {
  if (d.code === 'unused-includes') return { ...d, severity: 4, tags: [...new Set([...(d.tags ?? []), 1])] }
  if (isUnknownAttribute(d)) {
    const name = eosioAttributeName(ctx.underlined)
    if (name !== null && !KNOWN_EOSIO_ATTRIBUTES.includes(name)) {
      const near = nearestAttribute(name)
      const message =
        `Unknown attribute 'eosio::${name}': the compiler ignores it, so it has no effect.` + (near ? ` Did you mean [[eosio::${near}]]?` : '')
      return { ...d, message }
    }
  }
  return d
}

export function filterDiagnostics(list: LspDiagnostic[], docUri: string, setup: FlagSetup): LspDiagnostic[] {
  return list.filter((d) => keepDiagnostic(d, docUri, setup))
}
