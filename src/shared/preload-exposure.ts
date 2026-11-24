// Which page may receive which interface from the preload script. The main process checks
// the sender of every call again; this is the second lock.

import { TERMINAL_ORIGIN, TERMINAL_PAGE, terminalPageUrl } from './terminal-frame'

export const EDITOR_ORIGIN = 'app://bundle'
/** Argument the main process adds in development only: the exact address of the dev server. */
export const DEV_URL_ARG = '--wax-dev-url='

export interface PageInfo {
  isTopFrame: boolean
  origin: string
  pathname: string
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const o = new URL(url).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

/** Reads the development server address from the process arguments, if present. */
export function devUrlFromArgv(argv: readonly string[]): string | undefined {
  const a = argv.find((x) => x.startsWith(DEV_URL_ARG))
  return a ? a.slice(DEV_URL_ARG.length) : undefined
}

/**
 * 'editor': top frame of app://bundle (or of the development server when one was given).
 * 'terminal': the terminal page in a sub frame of app://terminal (or its development twin).
 * null: nothing is exposed.
 */
export function interfaceFor(page: PageInfo, devUrl?: string): 'editor' | 'terminal' | null {
  const devOrigin = originOf(devUrl)
  if (page.isTopFrame) {
    if (page.pathname === TERMINAL_PAGE || page.pathname.endsWith('/confirm.html')) return null
    return page.origin === EDITOR_ORIGIN || (devOrigin !== null && page.origin === devOrigin) ? 'editor' : null
  }
  if (page.pathname !== TERMINAL_PAGE) return null
  if (page.origin === TERMINAL_ORIGIN) return 'terminal'
  const devTwin = devUrl ? originOf(terminalPageUrl(devUrl)) : null
  return devTwin !== null && page.origin === devTwin ? 'terminal' : null
}
