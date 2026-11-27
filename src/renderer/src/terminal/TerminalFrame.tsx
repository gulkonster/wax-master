// The terminal page. It runs in its own frame (app://terminal) inside the
// bottom panel and is the only page that can reach the terminal and clipboard
// calls. The editor window sends it only the fixed commands of
// shared/terminal-frame.ts; it never accepts text to write from there.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalProfile, TerminalProfileInfo } from '../../../shared/api'
import { parseTerminalCommand, type TerminalCommand, type TerminalFrameEvent } from '../../../shared/terminal-frame'
import { IconChevronDown, IconClose, IconPlus } from '../components/Icons'
import { THEMES, TERMINAL_ANSI_LIGHT } from '../lib/theme-colors'
import { currentTheme, onThemeChange } from '../lib/theme'
import type { ResolvedTheme } from '../../../shared/api'
import { menuPosition, onShellExit, pasteText, shellEndedMessage } from './terminal-actions'

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

/** The right-click menu: where it was opened and what it can do there. */
interface ContextMenu {
  x: number
  y: number
  tabId: string
  canCopy: boolean
  canPaste: boolean
}

/** xterm colours for a theme (dark keeps xterm's own terminal colours 0-15). */
function terminalTheme(theme: ResolvedTheme): NonNullable<ConstructorParameters<typeof Terminal>[0]>['theme'] {
  const c = THEMES[theme]
  const base = { background: c.content, foreground: c.text, cursor: c.accent, cursorAccent: c.content, selectionBackground: c.selection }
  return theme === 'light' ? { ...base, ...TERMINAL_ANSI_LIGHT } : base
}

export function TerminalFrame(): React.JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<TerminalProfileInfo[]>([])
  const [gitHint, setGitHint] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const [ctxPos, setCtxPos] = useState<{ left: number; top: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement | null>(null)
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

  // The terminals follow the theme of the page.
  useEffect(
    () =>
      onThemeChange((theme) => {
        for (const t of tabsRef.current) t.term.options.theme = terminalTheme(theme)
      }),
    []
  )

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
      theme: terminalTheme(currentTheme()),
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
    const tab: Tab = { id, title: PROFILE_TITLES[profile], term, fit, exited: false }
    // Once the shell has ended, typing in its tab sends nothing.
    term.onData((d) => {
      if (!tab.exited) void api().terminal.write(id, d)
    })
    term.onResize(({ cols, rows }) => {
      if (!tab.exited) void api().terminal.resize(id, cols, rows)
    })
    // Known at once, so output or an exit that comes before the next render finds its tab.
    tabsRef.current = [...tabsRef.current, tab]
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
      if (!t || t.exited) return
      t.exited = true
      // The shell ended on its own (any exit code): the tab closes as if its close button was pressed.
      if (onShellExit(code, error) === 'close') {
        closeRef.current(id)
        return
      }
      // A start failure or the helper ending: the tab stays with the message and takes no more input.
      t.term.options.disableStdin = true
      t.term.options.cursorBlink = false
      t.term.write(`\x1b[?25l\r\n\x1b[90m${shellEndedMessage(code, error)}\x1b[0m\r\n`)
      setCtxMenu((m) => (m?.tabId === id ? null : m))
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
    setCtxMenu((m) => (m?.tabId === id ? null : m))
    if (activeRef.current === id) setActive(next[next.length - 1]?.id ?? null)
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // Right click: a small menu with Copy (the selection) and Paste.
  const onContextMenu = (ev: React.MouseEvent): void => {
    ev.preventDefault()
    const t = activeTab()
    if (!t) return
    setCtxPos(null)
    setCtxMenu({ x: ev.clientX, y: ev.clientY, tabId: t.id, canCopy: t.term.hasSelection(), canPaste: !t.exited })
  }

  const runCtx = (what: 'copy' | 'paste'): void => {
    const m = ctxMenu
    setCtxMenu(null)
    const t = tabsRef.current.find((x) => x.id === m?.tabId)
    if (!m || !t) return
    if (what === 'copy' && m.canCopy) copySelection(t.term)
    if (what === 'paste' && m.canPaste && !t.exited) pasteFromClipboard(t.term)
    t.term.focus()
  }

  // Keep the menu inside the frame once its size is known.
  useLayoutEffect(() => {
    const el = ctxRef.current
    if (!ctxMenu || !el) return
    setCtxPos(menuPosition(ctxMenu.x, ctxMenu.y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight))
  }, [ctxMenu])

  // The menu closes on Escape, on any other key, on a click elsewhere, and
  // when the frame loses focus or changes size. Escape does not reach the shell.
  useEffect(() => {
    if (!ctxMenu) return
    const dismiss = (): void => setCtxMenu(null)
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node && ctxRef.current?.contains(e.target))) dismiss()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
      dismiss()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [ctxMenu])

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
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="context-menu"
          role="menu"
          aria-label="Terminal"
          style={{ left: ctxPos?.left ?? ctxMenu.x, top: ctxPos?.top ?? ctxMenu.y, visibility: ctxPos ? 'visible' : 'hidden' }}
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className={`dd-item${ctxMenu.canCopy ? '' : ' disabled'}`}
            role="menuitem"
            aria-disabled={!ctxMenu.canCopy}
            onClick={() => ctxMenu.canCopy && runCtx('copy')}
          >
            <span className="dd-label">Copy</span>
            <span className="dd-key">Ctrl+C</span>
          </div>
          <div
            className={`dd-item${ctxMenu.canPaste ? '' : ' disabled'}`}
            role="menuitem"
            aria-disabled={!ctxMenu.canPaste}
            onClick={() => ctxMenu.canPaste && runCtx('paste')}
          >
            <span className="dd-label">Paste</span>
            <span className="dd-key">Ctrl+V</span>
          </div>
        </div>
      )}
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
                style={{ position: 'fixed', top: 'var(--ctl)', right: 'var(--sp-1)', maxHeight: 'calc(100vh - var(--ctl) - var(--sp-1))' }}
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
              <IconClose size="xs" />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
