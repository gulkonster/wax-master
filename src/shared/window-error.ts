// Errors of the editor page, reported one way to the main log so a broken view
// leaves a line there. A report holds only what the code produced: the kind,
// the first line of the error message (at most 500 characters) and up to five
// places in the app's own script files (file name, line, column). No stack
// text with other paths, no component props, nothing the user typed.

export const WINDOW_ERROR_CHANNEL = 'app:windowError'
export const MAX_WINDOW_ERROR_MESSAGE = 500
export const MAX_WINDOW_ERROR_PLACES = 5
/** At most this many reports a minute are written; the rest are counted and dropped. */
export const MAX_WINDOW_ERRORS_PER_MINUTE = 20

export type WindowErrorKind = 'error' | 'rejection' | 'render'
const KINDS: readonly WindowErrorKind[] = ['error', 'rejection', 'render']

export interface WindowErrorReport {
  kind: WindowErrorKind
  message: string
  /** `file.js:line:col` of the app's own script files, outermost last. */
  places: string[]
}

/** One place of the app's own scripts: a plain file name, a line and a column. */
const PLACE = /^[A-Za-z0-9_.-]{1,80}\.(?:js|mjs|ts|tsx):\d{1,7}:\d{1,7}$/

/** Any line break character: CR, LF and the Unicode line and paragraph separators (built from their codes). */
const LINE_BREAK = new RegExp(`[${String.fromCharCode(13, 10, 0x2028, 0x2029)}]`)

/** The first line of a text, control characters removed, at most 500 characters. */
export function oneLine(text: string): string {
  const first = text.split(LINE_BREAK, 1)[0] ?? ''
  const clean = first.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
  return clean.length > MAX_WINDOW_ERROR_MESSAGE ? `${clean.slice(0, MAX_WINDOW_ERROR_MESSAGE - 3)}...` : clean
}

/**
 * The places of a stack that lie in the app's own pages (`origins`, such as
 * app://bundle), reduced to `file:line:col`. Any other frame is left out.
 */
export function stackPlaces(stack: string | undefined, origins: readonly string[]): string[] {
  if (!stack) return []
  const out: string[] = []
  for (const m of stack.matchAll(/((?:app|https?):\/\/[^\s()]+?):(\d+):(\d+)/g)) {
    let u: URL
    try {
      u = new URL(m[1])
    } catch {
      continue
    }
    // `origin` is "null" for app:// outside the browser, so it is built from its parts.
    if (!origins.includes(`${u.protocol}//${u.host}`)) continue
    const file = u.pathname.split('/').pop() ?? ''
    const place = `${file}:${m[2]}:${m[3]}`
    if (PLACE.test(place)) out.push(place)
    if (out.length >= MAX_WINDOW_ERROR_PLACES) break
  }
  return out
}

/** Builds a report from whatever was thrown (an Error or any other value). */
export function makeWindowErrorReport(kind: WindowErrorKind, thrown: unknown, origins: readonly string[]): WindowErrorReport {
  let message: string
  let stack: string | undefined
  if (thrown instanceof Error) {
    message = `${thrown.name}: ${thrown.message}`
    stack = thrown.stack
  } else if (typeof thrown === 'string') {
    message = thrown
  } else {
    message = thrown === undefined || thrown === null ? 'no error value' : `a ${typeof thrown} was thrown`
  }
  return { kind, message: oneLine(message) || 'no message', places: stackPlaces(stack, origins) }
}

/** Checks a report sent by the page. Returns null for anything not exactly of the report's shape. */
export function parseWindowErrorReport(raw: unknown): WindowErrorReport | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 3 || !['kind', 'message', 'places'].every((k) => keys.includes(k))) return null
  const r = raw as Record<string, unknown>
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind as WindowErrorKind)) return null
  if (typeof r.message !== 'string' || r.message.length > 4 * MAX_WINDOW_ERROR_MESSAGE) return null
  if (!Array.isArray(r.places) || r.places.length > MAX_WINDOW_ERROR_PLACES) return null
  if (!r.places.every((p) => typeof p === 'string' && PLACE.test(p))) return null
  const message = oneLine(r.message)
  if (!message) return null
  return { kind: r.kind as WindowErrorKind, message, places: [...(r.places as string[])] }
}

/** The log line of a report. */
export function windowErrorLine(r: WindowErrorReport): string {
  const what = r.kind === 'render' ? 'A view failed to draw' : r.kind === 'rejection' ? 'Unhandled rejection in the window' : 'Error in the window'
  return `${what}: ${r.message}${r.places.length ? ` (at ${r.places.join(', ')})` : ''}`
}

/** Lets through at most `limit` reports per minute. */
export function windowErrorLimiter(limit = MAX_WINDOW_ERRORS_PER_MINUTE, now: () => number = Date.now): () => boolean {
  let start = 0
  let count = 0
  return () => {
    const t = now()
    if (t - start >= 60_000) {
      start = t
      count = 0
    }
    count++
    return count <= limit
  }
}
