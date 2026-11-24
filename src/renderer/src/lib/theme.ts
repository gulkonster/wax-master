// The resolved theme of this page. The preload sets `data-theme` on <html>
// before the first paint and again whenever the main process reports a change;
// pages only read it.

import type { ResolvedTheme } from '../../../shared/api'

export function currentTheme(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

/** Calls `cb` whenever the theme of this page changes; returns the unsubscribe function. */
export function onThemeChange(cb: (theme: ResolvedTheme) => void): () => void {
  let last = currentTheme()
  const watch = new MutationObserver(() => {
    const now = currentTheme()
    if (now !== last) {
      last = now
      cb(now)
    }
  })
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => watch.disconnect()
}
