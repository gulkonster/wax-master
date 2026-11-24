import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalProfile, TerminalProfileInfo } from '../../../shared/api'
import { useApp } from '../state'
import { on } from '../lib/bus'
import { errorText, toast } from '../lib/toast'
import { IconChevronDown, IconClose, IconPlus } from './Icons'

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

export function TerminalPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const { state } = useApp()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<TerminalProfileInfo[]>([])
  const [gitHint, setGitHint] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mounts = useRef(new Map<string, HTMLDivElement>())
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const loadProfiles = useCallback(async () => {
    const r = await window.wax.terminal.profiles()
    setProfiles(r.profiles)
    setGitHint(r.gitHint)
  }, [])

  const create = useCallback(
    async (profile: TerminalProfile, rel: string | null = null) => {
      const term = new Terminal({
        fontFamily: "'Cascadia Mono', Consolas, monospace",
        fontSize: state.settings?.fontSize ? Math.max(10, state.settings.fontSize - 1) : 13,
        theme: { background: '#1e1f21', foreground: '#d4d4d4' },
        scrollback: 5000,
        allowProposedApi: false,
        cursorBlink: true
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      let id: string
      try {
        id = await window.wax.terminal.create(profile, rel, 80, 24)
      } catch (e) {
        term.dispose()
        toast('Could not open a terminal', errorText(e), 'error')
        return
      }
      // Copy with Ctrl+C when text is selected, paste with Ctrl+V; multi-line paste asks first.
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== 'keydown') return true
        if (ev.ctrlKey && !ev.shiftKey && ev.key === 'c' && term.hasSelection()) {
          void window.wax.clipboard.writeText(term.getSelection())
          term.clearSelection()
          return false
        }
        if (ev.ctrlKey && (ev.key === 'v' || ev.key === 'V')) {
          void window.wax.clipboard.readText().then((text) => {
            if (!text) return
            if (/\r|\n/.test(text.trim()) && !window.confirm(`Paste ${text.split(/\r?\n/).length} lines into the terminal? Each line may run as a command.`)) return
            term.paste(text)
          })
          return false
        }
        return true
      })
      term.onData((d) => void window.wax.terminal.write(id, d))
      term.onResize(({ cols, rows }) => void window.wax.terminal.resize(id, cols, rows))
      const tab: Tab = { id, title: PROFILE_TITLES[profile], term, fit, exited: false }
      setTabs((t) => [...t, tab])
      setActive(id)
    },
    [state.settings?.fontSize]
  )

  // Data and exit events from the helper.
  useEffect(() => {
    const offData = window.wax.on('terminal-data', (id: string, data: string) => {
      tabsRef.current.find((t) => t.id === id)?.term.write(data)
    })
    const offExit = window.wax.on('terminal-exit', (id: string, code: number, error: string) => {
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
    void loadProfiles()
  }, [loadProfiles, state.project?.path])

  // Open a terminal the first time the panel is shown.
  useEffect(() => {
    if (visible && tabsRef.current.length === 0) void create(state.settings?.terminalProfile ?? 'powershell')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(
    () =>
      on('terminal-open-here', (rel) => {
        void create(state.settings?.terminalProfile ?? 'powershell', rel as string)
      }),
    [create, state.settings?.terminalProfile]
  )

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
      const t = tabsRef.current.find((x) => x.id === active)
      if (t && visible) {
        try {
          t.fit.fit()
        } catch {
          // ignore while hidden
        }
      }
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [active, visible])

  useEffect(() => {
    if (!visible) return
    const t = tabsRef.current.find((x) => x.id === active)
    if (t) {
      requestAnimationFrame(() => {
        try {
          t.fit.fit()
        } catch {
          // ignore
        }
        t.term.focus()
      })
    }
  }, [active, visible])

  const close = (id: string): void => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    if (!t.exited) void window.wax.terminal.kill(id)
    t.term.dispose()
    mounts.current.delete(id)
    const next = tabsRef.current.filter((x) => x.id !== id)
    setTabs(next)
    if (active === id) setActive(next[next.length - 1]?.id ?? null)
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-host" ref={hostRef}>
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
        {tabs.length === 0 && <div style={{ padding: 12, color: 'var(--text-dim)' }}>No terminal open.</div>}
      </div>
      <div className="terminal-list">
        <div className="terminal-list-head">
          <button className="icon-btn" title="New terminal" onClick={() => void create(state.settings?.terminalProfile ?? 'powershell')}>
            <IconPlus />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" title="New terminal with profile" onClick={() => setMenuOpen((o) => !o)}>
              <IconChevronDown />
            </button>
            {menuOpen && (
              <div className="dropdown right" style={{ top: 'auto', bottom: '100%' }} onMouseLeave={() => setMenuOpen(false)}>
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className="dd-item"
                    style={{ opacity: p.available ? 1 : 0.5 }}
                    title={p.note}
                    onClick={() => {
                      setMenuOpen(false)
                      if (p.available) void create(p.id)
                      else if (p.note) toast(p.label, p.note)
                    }}
                  >
                    {p.label}
                  </div>
                ))}
                {gitHint && <div className="dd-note" style={{ whiteSpace: 'normal', maxWidth: 260 }}>{gitHint}</div>}
              </div>
            )}
          </div>
        </div>
        {tabs.map((t) => (
          <div key={t.id} className={`terminal-item${t.id === active ? ' active' : ''}`} onClick={() => setActive(t.id)}>
            <span style={{ opacity: t.exited ? 0.5 : 1 }}>{t.title}</span>
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
