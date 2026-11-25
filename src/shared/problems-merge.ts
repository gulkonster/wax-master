// One Problems list from the last build and from the editor (B101 points 2 and 4).

import type { Problem } from './api'

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

/**
 * Build problems and live problems as one list, each problem once:
 * - a build problem of a file in `changedFiles` (its text differs from the text
 *   that was built) is left out;
 * - a build problem is left out when a live problem has the same file, line and
 *   severity;
 * - a problem without a place (linker, ABI generator, ABI check) stays.
 * Order: errors, warnings, notes; then by file, line and column; problems
 * without a place last in their group; equal places keep their input order.
 */
export function mergeProblems(build: Problem[], live: Problem[], changedFiles: ReadonlySet<string>): Problem[] {
  const seen = new Set(live.map((p) => `${p.file}\u0000${p.line}\u0000${p.severity}`))
  const kept = build.filter((p) => {
    if (!p.file) return true
    if (changedFiles.has(p.file)) return false
    return !seen.has(`${p.file}\u0000${p.line}\u0000${p.severity}`)
  })
  return [...kept, ...live]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const s = (SEVERITY_ORDER[a.p.severity] ?? 3) - (SEVERITY_ORDER[b.p.severity] ?? 3)
      if (s) return s
      if (!a.p.file !== !b.p.file) return a.p.file ? -1 : 1
      if (a.p.file !== b.p.file) return a.p.file < b.p.file ? -1 : 1
      return a.p.line - b.p.line || a.p.column - b.p.column || a.i - b.i
    })
    .map((x) => x.p)
}
