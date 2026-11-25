// One classifier for compiler and build output lines. The Output panel colours
// each line with it, the Problems list is filled from it and the status-bar
// counts come from the Problems list, so the three cannot disagree.

import { NAME_RULE } from './contract-checks'

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

/** The hint the Problems entry of a Ricardian warning of the ABI generator carries. */
export const RICARDIAN_HINT = 'Contract > Create Ricardian Files writes the missing sections'

/** True for the ABI generator's Ricardian warnings (a missing action text, an empty file). */
export function isRicardianWarning(message: string): boolean {
  return /does not have a ricardian contract|empty ricardian clause file/i.test(message)
}

/** The name rule as the Problems row of a refused name carries it (the sentence of the editor's name messages). */
export const NAME_HINT = NAME_RULE

/** True for the ABI generator's refusals of a name: not normalized, or more than 13 characters. */
export function isNameRuleError(message: string): boolean {
  return /name not properly normalized|is more than 13 characters long/i.test(message)
}

export type ProblemSeverity = 'error' | 'warning' | 'info'

/** Severity of a line as a Problems entry (null: the line is not a problem of its own). */
export function problemSeverity(c: ClassifiedLine): ProblemSeverity | null {
  if (c.kind !== 'diagnostic' && c.kind !== 'message') return null
  return c.severity === 'error' ? 'error' : c.severity === 'warning' ? 'warning' : c.severity === 'note' ? 'info' : null
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

/** The Problems list order: errors, then warnings, then notes; the build's order within each. */
export function orderProblems<T extends { severity: string }>(list: readonly T[]): T[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (SEVERITY_ORDER[a.p.severity] ?? 3) - (SEVERITY_ORDER[b.p.severity] ?? 3) || a.i - b.i)
    .map((x) => x.p)
}

/**
 * Each problem once. The toolchain prints a missing Ricardian section of an
 * action three times (once with its place in the source, twice as a line
 * without a place) and the empty clause file twice: the entry with a place is
 * kept, otherwise the first.
 */
export function uniqueProblems<T extends { file: string; line: number; column: number; severity: string; message: string; source: string }>(list: readonly T[]): T[] {
  const keyOf = (p: T): string => {
    const action = /action <([^>]+)> does not have a ricardian contract/i.exec(p.message)
    if (action) return ['ricardian', p.severity, action[1]].join('\u0000')
    return [p.source, p.severity, p.file, p.line, p.column, p.message].join('\u0000')
  }
  const best = new Map<string, T>()
  for (const p of list) {
    const k = keyOf(p)
    const had = best.get(k)
    if (!had || (!had.file && p.file)) best.set(k, p)
  }
  return list.filter((p) => best.get(keyOf(p)) === p)
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

/** A compiler path that is not inside the project: the toolchain's own headers, or a file outside the project folder. */
export function isOutsideProject(file: string): boolean {
  return /^(\/|[A-Za-z]:)/.test(file)
}

const INSTANTIATION_NOTE = /^in (instantiation of .* requested here|call to\b)/i

/**
 * An error or warning whose file is not in the project (a failure deep inside
 * the toolchain's templates) takes the place of the first following note
 * `in instantiation ... requested here` or `in call to ...` that is in the
 * project, up to the next error or warning line. The message then ends with
 * the toolchain file's base name and line in brackets. Without such a note the
 * problem stays as it is.
 */
export function placeToolchainProblems<T extends { file: string; line: number; column: number; severity: string; message: string }>(list: readonly T[]): T[] {
  const out = list.map((p) => ({ ...p }))
  for (let i = 0; i < out.length; i++) {
    const p = out[i]
    if ((p.severity !== 'error' && p.severity !== 'warning') || !p.file || !isOutsideProject(p.file)) continue
    for (let j = i + 1; j < out.length; j++) {
      const n = out[j]
      if (n.severity === 'error' || n.severity === 'warning') break
      if (n.severity !== 'info' || !n.file || isOutsideProject(n.file) || !INSTANTIATION_NOTE.test(n.message)) continue
      const base = p.file.slice(p.file.lastIndexOf('/') + 1)
      p.message = `${p.message} [${base}:${p.line}]`
      p.file = n.file
      p.line = n.line
      p.column = n.column
      break
    }
  }
  return out
}
