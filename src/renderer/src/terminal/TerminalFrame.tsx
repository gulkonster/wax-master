// The terminal page. It runs in its own frame (app://terminal) inside the
// bottom panel and is the only page that can reach the terminal and clipboard
// calls. The editor window sends it only the fixed commands of
// shared/terminal-frame.ts; it never accepts text to write from there.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalProfile, TerminalProfileInfo } from '../../../shared/api'
import { parseTerminalCommand, type TerminalCommand, type TerminalFrameEvent } from '../../../shared/terminal-frame'
import { IconChevronDown, IconClose, IconPlus } from '../components/Icons'
import { THEME } from '../lib/theme-colors'

interface Tab {
  id: string
  title: string
  term: Terminal
  fit: FitAddon
  exited: boolean
}

const PROFILE_TITLES: Record<TerminalProfile, string> = {
  powershell: 'PowerShell',
  cmd: 'cmd',
  toolchain: 'Toolchain (Linux)'
}

/** The editor page that may embed and command this frame. */
function editorOrigin(): string {
  if (location.protocol === 'app:') return 'app://bundle'
  // Development server: the editor page under the other loopback host name.
  const parent = location.ancestorOrigins?.[0] ?? ''
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(parent) ? parent : ''
}

const EDITOR_ORIGIN = editorOrigin()

function tell(m: TerminalFrameEvent): void {
  if (EDITOR_ORIGIN && window.parent !== window) window.parent.postMessage(m, EDITOR_ORIGIN)
}

function notice(title: string, text = '', error = false): void {
  tell({ type: 'notice', title, text, error })
}

function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const api = (): typeof window.waxTerminal => window.waxTerminal

/**
 * The one paste path. Ctrl+V, Shift+Insert, right click and Edit > Paste all
 * end here; text with more than one line asks first.
 */
export function pasteText(term: Terminal, text: string): void {
  if (!text) return
  if (/\r|\n/.test(text.trim())) {
    const lines = text.trim().split(/\r\n|\r|\n/).length
    if (!window.confirm(`Paste ${lines} lines into the terminal? Each line may run as a command.`)) return
  }
  term.paste(text)
}

export function TerminalFrame(): React.JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<TerminalProfileInfo[]>([])
  const [gitHint, setGitHint] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mounts = useRef(new Map<string, HTMLDivElement>())
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active
  const fontSize = useRef(13)
  const pending = useRef(0)
  // The default profile from the settings, as last sent with "show".
  const defaultProfile = useRef<TerminalProfile>('powershell')

  const activeTab = (): Tab | undefined => tabsRef.current.find((t) => t.id === activeRef.current)

  const loadProfiles = useCallback(async () => {
    try {
      const r = await api().terminal.profiles()
      setProfiles(r.profiles)
      setGitHint(r.gitHint)
    } catch (e) {
      notice('Could not list terminal profiles', errorText(e), true)
    }
  }, [])

  const copySelection = (term: Terminal): void => {
    const text = term.getSelection()
    term.clearSelection()
    if (text) void api().clipboard.writeText(text)
  }

  const pasteFromClipboard = (term: Terminal): void => {
    void api()
      .clipboard.readText()
      .then((text) => pasteText(term, text))
      .catch((e) => notice('Paste failed', errorText(e), true))
  }

  const create = useCallback(async (profile: TerminalProfile, rel: string | null = null) => {
    pending.current++
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: fontSize.current,
      theme: { background: THEME.content, foreground: THEME.text, cursor: THEME.accent, cursorAccent: THEME.content, selectionBackground: THEME.selection },
      scrollback: 5000,
      allowProposedApi: false,
      cursorBlink: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    let id: string
    try {
      id = await api().terminal.create(profile, rel, 80, 24)
    } catch (e) {
      term.dispose()
      notice('Could not open a terminal', errorText(e), true)
      return
    } finally {
      pending.current--
    }
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      // Copy with Ctrl+C when text is selected.
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && (ev.key === 'c' || ev.key === 'C') && term.hasSelection()) {
        copySelection(term)
        return false
      }
      // Ctrl+V and Shift+Insert: xterm ignores the key and the browser's own
      // paste command raises the paste event handled below.
      if (ev.ctrlKey && !ev.altKey && (ev.key === 'v' || ev.key === 'V')) return false
      if (ev.shiftKey && ev.key === 'Insert') return false
      // Ctrl+` belongs to the menu (Toggle Terminal); leave it unhandled so the menu sees it.
      if (ev.ctrlKey && !ev.altKey && ev.code === 'Backquote') return false
      return true
    })
    term.onData((d) => void api().terminal.write(id, d))
    term.onResize(({ cols, rows }) => void api().terminal.resize(id, cols, rows))
    const tab: Tab = { id, title: PROFILE_TITLES[profile], term, fit, exited: false }
    setTabs((t) => [...t, tab])
    setActive(id)
  }, [])

  const fitActive = (focus: boolean): void => {
    const t = activeTab()
    if (!t) return
    requestAnimationFrame(() => {
      try {
        t.fit.fit()
      } catch {
        // not laid out yet
      }
      if (focus) t.term.focus()
    })
  }

  // Commands from the editor window: fixed shapes only, from the editor page only.
  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      if (!EDITOR_ORIGIN || ev.origin !== EDITOR_ORIGIN || ev.source !== window.parent) return
      const cmd: TerminalCommand | null = parseTerminalCommand(ev.data)
      if (!cmd) return
      switch (cmd.type) {
        case 'new':
          void create(cmd.profile)
          break
        case 'open-here':
          void create(cmd.profile, cmd.path)
          break
        case 'show':
          defaultProfile.current = cmd.profile
          setVisible(true)
          if (tabsRef.current.length === 0 && pending.current === 0) void create(cmd.profile)
          else fitActive(true)
          break
        case 'hide':
          setVisible(false)
          break
        case 'focus':
          fitActive(true)
          break
        case 'fit':
          fitActive(false)
          break
        case 'font-size':
          fontSize.current = cmd.size
          for (const t of tabsRef.current) t.term.options.fontSize = cmd.size
          fitActive(false)
          break
      }
    }
    window.addEventListener('message', onMessage)
    tell({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [create])

  // Edit > Paste, Ctrl+V and Shift+Insert arrive here as a paste event; xterm's
  // own paste handling never sees it.
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent): void => {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      const t = activeTab()
      if (t && !t.exited) pasteText(t.term, ev.clipboardData?.getData('text/plain') ?? '')
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [])

  // Data and exit events from the helper, sent to this frame only.
  useEffect(() => {
    const offData = api().on('terminal-data', (id: string, data: string) => {
      tabsRef.current.find((t) => t.id === id)?.term.write(data)
    })
    const offExit = api().on('terminal-exit', (id: string, code: number, error: string) => {
      const t = tabsRef.current.find((x) => x.id === id)
      if (!t) return
      t.exited = true
      t.term.write(`\r\n\x1b[90m[process exited with code ${code}${error ? `: ${error}` : ''}]\x1b[0m\r\n`)
      setTabs((list) => [...list])
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  useEffect(() => {
    if (visible) void loadProfiles()
  }, [loadProfiles, visible])

  // Attach each terminal to its element once.
  useEffect(() => {
    for (const t of tabs) {
      const el = mounts.current.get(t.id)
      if (el && !el.hasChildNodes()) {
        t.term.open(el)
        try {
          t.fit.fit()
        } catch {
          // not laid out yet
        }
      }
    }
  }, [tabs])

  // Fit the active terminal on size changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      if (visible) fitActive(false)
    })
    ro.observe(host)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, visible])

  useEffect(() => {
    if (visible) fitActive(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, visible])

  const close = (id: string): void => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    if (!t.exited) void api().terminal.kill(id)
    t.term.dispose()
    mounts.current.delete(id)
    const next = tabsRef.current.filter((x) => x.id !== id)
    setTabs(next)
    if (activeRef.current === id) setActive(next[next.length - 1]?.id ?? null)
  }

  // Right click: copy the selection, or paste when nothing is selected.
  const onContextMenu = (ev: React.MouseEvent): void => {
    ev.preventDefault()
    const t = activeTab()
    if (!t || t.exited) return
    if (t.term.hasSelection()) copySelection(t.term)
    else pasteFromClipboard(t.term)
  }

  return (
    <div className="terminal-panel" style={{ height: '100%' }}>
      <div className="terminal-host" ref={hostRef} onContextMenu={onContextMenu}>
        {tabs.map((t) => (
          <div
            key={t.id}
            className="terminal-mount"
            style={{ display: t.id === active ? 'block' : 'none' }}
            ref={(el) => {
              if (el) mounts.current.set(t.id, el)
            }}
          />
        ))}
        {tabs.length === 0 && <div className="empty-hint">No terminal open.</div>}
      </div>
      <div className="terminal-list">
        <div className="terminal-list-head">
          <button className="icon-btn" title="New terminal" onClick={() => void create(defaultProfile.current)}>
            <IconPlus />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" title="New terminal with profile" onClick={() => setMenuOpen((o) => !o)}>
              <IconChevronDown />
            </button>
            {menuOpen && (
              <div
                className="dropdown"
                style={{ position: 'fixed', top: 32, right: 4, maxHeight: 'calc(100vh - 36px)' }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className={`dd-item${p.available ? '' : ' disabled'}`}
                    title={p.note}
                    onClick={() => {
                      setMenuOpen(false)
                      if (p.available) void create(p.id)
                      else if (p.note) notice(p.label, p.note)
                    }}
                  >
                    {p.label}
                  </div>
                ))}
                {gitHint && <div className="dd-note wrap">{gitHint}</div>}
              </div>
            )}
          </div>
        </div>
        {tabs.map((t) => (
          <div key={t.id} className={`terminal-item${t.id === active ? ' active' : ''}`} onClick={() => setActive(t.id)}>
            <span className={t.exited ? 'exited' : undefined}>{t.title}</span>
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                close(t.id)
              }}
            >
              <IconClose size={11} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
