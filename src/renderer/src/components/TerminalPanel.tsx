// The editor side of the terminal: an <iframe> with the terminal page from its
// own origin (app://terminal). This page cannot reach the shells; it sends the
// frame only the fixed commands of shared/terminal-frame.ts (new terminal,
// open here, show, hide, focus, fit, font size) and never any text for a shell.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { parseTerminalFrameEvent, terminalPageUrl, type TerminalCommand } from '../../../shared/terminal-frame'
import { useApp } from '../state'
import { on } from '../lib/bus'
import { toast } from '../lib/toast'

export function TerminalPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const { state } = useApp()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const ready = useRef(false)
  const queue = useRef<TerminalCommand[]>([])
  const src = useMemo(() => terminalPageUrl(location.href), [])
  const frameOrigin = useMemo(() => new URL(src).origin, [src])
  const profile = state.settings?.terminalProfile ?? 'powershell'
  const fontSize = state.settings?.fontSize ? Math.max(10, state.settings.fontSize - 1) : 13

  const post = useCallback(
    (cmd: TerminalCommand) => {
      const win = frameRef.current?.contentWindow
      if (!ready.current || !win) {
        queue.current.push(cmd)
        return
      }
      win.postMessage(cmd, frameOrigin)
    },
    [frameOrigin]
  )

  // Events from the frame: "ready" and notices shown as toasts.
  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      if (ev.origin !== frameOrigin || !frameRef.current || ev.source !== frameRef.current.contentWindow) return
      const m = parseTerminalFrameEvent(ev.data)
      if (!m) return
      if (m.type === 'ready') {
        ready.current = true
        const pending = queue.current
        queue.current = []
        for (const cmd of pending) post(cmd)
      } else {
        toast(m.title, m.text, m.error ? 'error' : 'info')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frameOrigin, post])

  useEffect(() => post({ type: 'font-size', size: fontSize }), [fontSize, post])

  useEffect(() => {
    if (visible) {
      frameRef.current?.focus()
      post({ type: 'show', profile })
    } else {
      post({ type: 'hide' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(
    () =>
      on('terminal-open-here', (rel) => {
        const path = typeof rel === 'string' ? rel.replace(/\\/g, '/').replace(/^\.\/?$/, '') : ''
        frameRef.current?.focus()
        post(path ? { type: 'open-here', profile, path } : { type: 'new', profile })
      }),
    [post, profile]
  )

  useEffect(() => on('layout', () => post({ type: 'fit' })), [post])

  return (
    <iframe
      ref={frameRef}
      src={src}
      title="Terminal"
      className="terminal-frame"
      style={{ flex: 1, minWidth: 0, width: '100%', height: '100%', border: 0, display: 'block', background: 'var(--bg)' }}
    />
  )
}
