// Plain rules of the terminal page: the paste path, what happens when a shell
// ends, and where the right-click menu goes. Kept apart from the page so they
// can be checked without a browser.

/** The part of an xterm terminal the paste path needs. */
export interface PasteTarget {
  paste(text: string): void
}

/**
 * The one paste path. Ctrl+V, Shift+Insert, Paste in the right-click menu and
 * Edit > Paste all end here. Text of any length is pasted as it is; xterm sends
 * it as one bracketed paste when the shell asks for that.
 */
export function pasteText(term: PasteTarget, text: string): void {
  if (!text) return
  term.paste(text)
}

/**
 * What a terminal tab does when its shell ends. A shell that ends on its own,
 * with any exit code (`exit`, also after a failed command), closes its tab as
 * if its close button was pressed. Only an error (the shell could not start,
 * or the helper process ended) keeps the tab open with a message.
 */
export function onShellExit(_code: number, error: string): 'close' | 'keep' {
  return error ? 'keep' : 'close'
}

/** The line written into a tab whose shell ended and stays open. */
export function shellEndedMessage(code: number, error: string): string {
  const why = error ? `exit code ${code}: ${error}` : `exit code ${code}`
  return `[The shell ended (${why}). Typing here does nothing. Close this tab, or open a new terminal with + above the terminal list.]`
}

/**
 * Where a menu of `w` x `h` opened at (x, y) is drawn so it stays inside a
 * view of `viewW` x `viewH`: to the left of the pointer when there is no room
 * to the right, above it when there is no room below.
 */
export function menuPosition(x: number, y: number, w: number, h: number, viewW: number, viewH: number): { left: number; top: number } {
  const left = x + w <= viewW ? x : Math.max(0, Math.min(x - w, viewW - w))
  const top = y + h <= viewH ? y : Math.max(0, Math.min(y - h, viewH - h))
  return { left, top }
}
