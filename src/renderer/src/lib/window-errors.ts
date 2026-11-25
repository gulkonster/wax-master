// Sends errors of this page to the main log: uncaught errors, unhandled
// rejections and views that failed to draw. Only the message line and the
// places in the app's own scripts leave the page (see shared/window-error).

import { makeWindowErrorReport, repeatFilter, type WindowErrorKind } from '../../../shared/window-error'

function ownOrigins(): string[] {
  return [`${location.protocol}//${location.host}`]
}

/** One draw failure is written once, even when React catches it twice. */
const notRepeated = repeatFilter()

export function reportWindowError(kind: WindowErrorKind, thrown: unknown): void {
  try {
    const report = makeWindowErrorReport(kind, thrown, ownOrigins())
    if ((kind === 'render' || kind === 'render-window') && !notRepeated(report)) return
    window.wax?.app.reportError(report)
  } catch {
    // reporting must never throw
  }
}

let installed = false

/** Listens for uncaught errors and unhandled rejections of the page; once. */
export function installWindowErrorReports(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => reportWindowError('error', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => reportWindowError('rejection', e.reason))
}
