// Errors of the editor page, written to the main log. One way: the page sends,
// nothing is answered. Only the main frame of the editor page is heard; the
// report is checked field by field, cut to one short line with folder paths
// replaced by [path], and passed through the log's redaction like every other
// line, at most 20 a minute; the number of reports dropped in a minute is
// written with the first report after it.

import { ipcMain, type IpcMainEvent } from 'electron'
import { WINDOW_ERROR_CHANNEL, droppedLine, parseWindowErrorReport, windowErrorLimiter, windowErrorLine } from '../shared/window-error'
import { fromMainPage } from './ipc'
import { log } from './log'

/** Handles one report; exported for the tests. Returns true when a line was written. */
export function onWindowError(e: Pick<IpcMainEvent, 'senderFrame' | 'sender'>, raw: unknown, allow: () => boolean): boolean {
  if (!fromMainPage(e)) return false
  const report = parseWindowErrorReport(raw)
  if (!report || !allow()) return false
  log.error(windowErrorLine(report))
  return true
}

export function registerWindowErrors(): void {
  const allow = windowErrorLimiter(undefined, undefined, (n) => log.error(droppedLine(n)))
  ipcMain.on(WINDOW_ERROR_CHANNEL, (e, raw: unknown) => {
    try {
      onWindowError(e, raw, allow)
    } catch {
      // a report must never disturb the main process
    }
  })
}
