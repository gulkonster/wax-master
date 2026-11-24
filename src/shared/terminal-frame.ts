// The fixed set of messages between the editor window and the terminal frame.
// The editor window never sends text for the shell; every field below is a
// profile id from the fixed list, a number, a flag or a project-relative path
// that the main process checks again.

import type { TerminalProfile } from './api'
import { relPath } from './validate'

export const TERMINAL_HOST = 'terminal'
export const TERMINAL_ORIGIN = `app://${TERMINAL_HOST}`
export const TERMINAL_PAGE = '/terminal.html'

const PROFILES: readonly TerminalProfile[] = ['powershell', 'cmd', 'toolchain']

/** Editor window to terminal frame. */
export type TerminalCommand =
  | { type: 'new'; profile: TerminalProfile }
  | { type: 'open-here'; profile: TerminalProfile; path: string }
  | { type: 'show'; profile: TerminalProfile }
  | { type: 'hide' }
  | { type: 'focus' }
  | { type: 'fit' }
  | { type: 'font-size'; size: number }

/** Terminal frame to editor window. */
export type TerminalFrameEvent = { type: 'ready' } | { type: 'notice'; title: string; text: string; error: boolean }

function isProfile(v: unknown): v is TerminalProfile {
  return typeof v === 'string' && (PROFILES as readonly string[]).includes(v)
}

function isRelPath(v: unknown): v is string {
  try {
    return relPath(v, 'path') !== ''
  } catch {
    return false
  }
}

/** Returns the command when the message has exactly one of the fixed shapes, else null. */
export function parseTerminalCommand(data: unknown): TerminalCommand | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const m = data as Record<string, unknown>
  const keys = Object.keys(m).sort().join(',')
  switch (m.type) {
    case 'new':
    case 'show':
      return keys === 'profile,type' && isProfile(m.profile) ? { type: m.type, profile: m.profile } : null
    case 'open-here':
      return keys === 'path,profile,type' && isProfile(m.profile) && isRelPath(m.path)
        ? { type: 'open-here', profile: m.profile, path: m.path }
        : null
    case 'hide':
    case 'focus':
    case 'fit':
      return keys === 'type' ? { type: m.type } : null
    case 'font-size':
      return keys === 'size,type' && Number.isInteger(m.size) && (m.size as number) >= 8 && (m.size as number) <= 40
        ? { type: 'font-size', size: m.size as number }
        : null
    default:
      return null
  }
}

/** Returns the event when the message has one of the fixed shapes, else null. */
export function parseTerminalFrameEvent(data: unknown): TerminalFrameEvent | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const m = data as Record<string, unknown>
  if (m.type === 'ready') return { type: 'ready' }
  if (m.type === 'notice' && typeof m.title === 'string' && typeof m.text === 'string') {
    return { type: 'notice', title: m.title.slice(0, 200), text: m.text.slice(0, 2000), error: m.error === true }
  }
  return null
}

/**
 * Address of the terminal page as seen from an editor page at `editorHref`.
 * Packaged and built runs: app://terminal/terminal.html. Development server:
 * the same port under the other loopback host name, so the frame is a
 * different origin from the editor page.
 */
export function terminalPageUrl(editorHref: string): string {
  const u = new URL(editorHref)
  if (u.protocol === 'app:') return `${TERMINAL_ORIGIN}${TERMINAL_PAGE}`
  const host = u.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  return `${u.protocol}//${host}:${u.port}${TERMINAL_PAGE}`
}
