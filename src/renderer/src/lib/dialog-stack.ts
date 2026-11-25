// Order of the open dialogs. A dialog opened later is drawn over the ones already
// open, whatever its place in the page (a dialog opened from a button of the help
// window over Create Account goes over Create Account), and only the top one
// takes Escape.

const open = new Set<number>()

/** Takes the layer over every open dialog; call when the dialog appears. */
export function pushLayer(): number {
  const layer = open.size ? Math.max(...open) + 1 : 1
  open.add(layer)
  return layer
}

/** Gives the layer back; call when the dialog goes. */
export function popLayer(layer: number): void {
  open.delete(layer)
}

/** True when no open dialog is over this one. */
export function isTopLayer(layer: number): boolean {
  return open.size > 0 && Math.max(...open) === layer
}

const taken = new WeakSet<Event>()

/**
 * True for the one dialog that closes on this Escape press: the top one, and only
 * once per press (the top dialog may already be gone when a later listener runs).
 */
export function takeEscape(e: Event, layer: number): boolean {
  if (taken.has(e) || !isTopLayer(layer)) return false
  taken.add(e)
  return true
}
