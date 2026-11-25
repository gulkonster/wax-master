// Errors of the editor page, reported one way to the main log so a broken view
// leaves a line there. A report holds the kind, the first line of the error
// message (at most 500 characters) and up to five places in the app's own
// script files (file name, line, column). No stack text, no component props.
// The message is whatever the error carries, so it can hold a piece of text
// the user typed; before it is written, folder paths in it are replaced by
// [path] and the log's key and password patterns are applied to the line.

export const WINDOW_ERROR_CHANNEL = 'app:windowError'
export const MAX_WINDOW_ERROR_MESSAGE = 500
export const MAX_WINDOW_ERROR_PLACES = 5
/** At most this many reports a minute are written; the rest are dropped and their number written once the next minute starts. */
export const MAX_WINDOW_ERRORS_PER_MINUTE = 20

/** render: a view failed to draw; render-window: a part outside the views (the whole window's panel). */
export type WindowErrorKind = 'error' | 'rejection' | 'render' | 'render-window'
const KINDS: readonly WindowErrorKind[] = ['error', 'rejection', 'render', 'render-window']

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

// Folder names inside a path may hold spaces; its last part may not (the end of a path in a sentence is not known otherwise).
/** Windows drive paths, with either separator. */
const DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:[^\\/\s'"<>|*?]+(?: [^\\/\s'"<>|*?]+)*[\\/])*[^\\/\s'"<>|*?]*/g
/** Network share paths: two backslashes, a server name, a backslash, the rest. */
const UNC_PATH = /\\\\[^\\/\s'"<>|*?]+\\(?:[^\\/\s'"<>|*?]+(?: [^\\/\s'"<>|*?]+)*\\)*[^\\/\s'"<>|*?]*/g
/** file:// addresses. */
const FILE_URL = /\bfile:\/\/\S*/gi
/** Absolute POSIX paths of two or more parts (not the path part of an address such as https://host/a/b). */
const POSIX_PATH = /(?<![\w.:\/\\-])\/[^\s\/'"<>|]+(?:\/[^\s\/'"<>|]+)+\/?/g

/** A message with folder paths and file addresses replaced by [path]. */
export function withoutPaths(text: string): string {
  return text.replace(FILE_URL, '[path]').replace(UNC_PATH, '[path]').replace(DRIVE_PATH, '[path]').replace(POSIX_PATH, '[path]')
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
  const message = withoutPaths(oneLine(r.message))
  if (!message) return null
  return { kind: r.kind as WindowErrorKind, message, places: [...(r.places as string[])] }
}

/** The log line of a report. */
export function windowErrorLine(r: WindowErrorReport): string {
  const what =
    r.kind === 'render'
      ? 'A view failed to draw'
      : r.kind === 'render-window'
        ? 'The window failed to draw (outside the views)'
        : r.kind === 'rejection'
          ? 'Unhandled rejection in the window'
          : 'Error in the window'
  return `${what}: ${r.message}${r.places.length ? ` (at ${r.places.join(', ')})` : ''}`
}

/** The same draw failure sent again within this time is the same failure, not a new one. */
export const REPEAT_MS = 1000

/**
 * React can catch one draw failure twice (it draws the failed part once more
 * before showing the error panel). Returns a check that is false for a report
 * equal to the previous one when it comes within `windowMs` of it.
 */
export function repeatFilter(windowMs = REPEAT_MS, now: () => number = Date.now): (r: WindowErrorReport) => boolean {
  let last = ''
  let at = Number.NEGATIVE_INFINITY
  return (r) => {
    const key = JSON.stringify([r.kind, r.message, r.places])
    const t = now()
    const repeat = key === last && t - at < windowMs
    last = key
    at = t
    return !repeat
  }
}

/** The line written for the reports a full minute dropped. */
export function droppedLine(n: number): string {
  return `${n} more window error${n === 1 ? ' was' : 's were'} not written`
}

/**
 * Lets through at most `limit` reports per minute. The reports dropped in a
 * minute are counted; `onDropped` gets their number with the first report of
 * a later minute.
 */
export function windowErrorLimiter(
  limit = MAX_WINDOW_ERRORS_PER_MINUTE,
  now: () => number = Date.now,
  onDropped: (n: number) => void = () => undefined
): () => boolean {
  let start = 0
  let count = 0
  return () => {
    const t = now()
    if (t - start >= 60_000) {
      if (count > limit) onDropped(count - limit)
      start = t
      count = 0
    }
    count++
    return count <= limit
  }
}
