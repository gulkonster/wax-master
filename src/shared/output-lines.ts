// One classifier for compiler and build output lines. The Output panel colours
// each line with it, the Problems list is filled from it and the status-bar
// counts come from the Problems list, so the three cannot disagree.

/** Colour of a line: error (red), warning (yellow), note (grey), plain (normal text). */
export type LineSeverity = 'error' | 'warning' | 'note' | 'plain'

/**
 * What the line is:
 * - `diagnostic`: `file:line:column: severity: message` (a place in the source);
 * - `message`: an error or warning without a place (linker, ABI generator);
 * - `summary`: "N warnings generated." and the like (not counted again);
 * - `app`: a line the app writes itself (command line, build result, "ABI check:");
 * - `text`: anything else (source line, caret line, "In file included from").
 */
export type LineKind = 'diagnostic' | 'message' | 'summary' | 'app' | 'text'

export interface ClassifiedLine {
  severity: LineSeverity
  kind: LineKind
  /** The `file:line:column` part of a diagnostic: character range in the line and its values. */
  loc?: { start: number; end: number; file: string; line: number; column: number }
  /** Message text of a diagnostic or message line. */
  message?: string
}

/** Prefix of the app's own ABI check lines. */
export const ABI_CHECK_PREFIX = 'ABI check:'

const ANSI = /\x1b\[[0-9;]*m/g
// file:line:column: severity: message (file may contain a drive letter such as C:\...)
const DIAG = /^((?:[A-Za-z]:)?[^:]*?):(\d+):(\d+):\s+(fatal error|error|warning|note|remark):\s*(.*)$/

/** Removes terminal colour codes and the line end. */
export function cleanLine(raw: string): string {
  return raw.replace(ANSI, '').replace(/\r$/, '').trimEnd()
}

export function classifyLine(raw: string): ClassifiedLine {
  const line = cleanLine(raw)
  const m = DIAG.exec(line)
  if (m) {
    const kind = m[4]
    const severity: LineSeverity = kind === 'warning' ? 'warning' : kind === 'note' || kind === 'remark' ? 'note' : 'error'
    const end = m[1].length + 1 + m[2].length + 1 + m[3].length
    return {
      severity,
      kind: 'diagnostic',
      loc: { start: 0, end, file: m[1], line: Number(m[2]), column: Number(m[3]) },
      message: m[5]
    }
  }
  // The app's own lines.
  if (line.startsWith(ABI_CHECK_PREFIX) || /^Build failed\b/.test(line)) return { severity: 'error', kind: 'app' }
  if (/^Build (finished|cancelled|is up to date)\b/.test(line) || line.startsWith('> ')) return { severity: 'note', kind: 'app' }
  // Summaries: "2 errors generated.", "1 warning and 1 error generated.", "3 warnings generated."
  if (/^\d+ (warnings? and \d+ )?errors? generated\.$/.test(line)) return { severity: 'error', kind: 'summary' }
  if (/^\d+ warnings? generated\.$/.test(line)) return { severity: 'warning', kind: 'summary' }
  // Errors and warnings without a place: lines that begin with the word (the ABI
  // generator writes "Warning, ..." and "Error, ...") and tool lines such as
  // "wasm-ld: error: ..." or "ld.lld: warning: ...". Indented lines (source and
  // caret lines under a message) are never matched here.
  let mm = /^(?:error:|fatal error:|Error[,:])\s*(.*)$/.exec(line)
  if (mm) return { severity: 'error', kind: 'message', message: mm[1] }
  mm = /^(?:warning:|Warning[,:])\s*(.*)$/.exec(line)
  if (mm) return { severity: 'warning', kind: 'message', message: mm[1] }
  if (/^\S/.test(line)) {
    if (/: (fatal )?error:/.test(line)) return { severity: 'error', kind: 'message', message: line }
    if (/: warning:/.test(line)) return { severity: 'warning', kind: 'message', message: line }
    if (/: note:/.test(line)) return { severity: 'note', kind: 'text' }
  }
  return { severity: 'plain', kind: 'text' }
}

export type ProblemSeverity = 'error' | 'warning' | 'info'

/** Severity of a line as a Problems entry (null: the line is not a problem of its own). */
export function problemSeverity(c: ClassifiedLine): ProblemSeverity | null {
  if (c.kind !== 'diagnostic' && c.kind !== 'message') return null
  return c.severity === 'error' ? 'error' : c.severity === 'warning' ? 'warning' : c.severity === 'note' ? 'info' : null
}

/** Error and warning counts for the Problems tab and the status bar. */
export function countProblems(list: readonly { severity: string }[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const p of list) {
    if (p.severity === 'error') errors++
    else if (p.severity === 'warning') warnings++
  }
  return { errors, warnings }
}
