import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetupStatus } from '../../../shared/api'
import { useApp } from '../state'
import { errorText } from '../lib/toast'
import { toolchainStore } from '../lib/stores'
import { ToolchainManager } from '../components/ToolchainManager'
import { IconCheck } from '../components/Icons'

type RowState = 'ok' | 'bad' | 'busy' | 'waiting'

export function refreshToolchainLabel(s: SetupStatus): void {
  const st = s.toolchain.state
  toolchainStore.set(
    s.toolchain.ok && st ? { ready: true, label: st.label } : { ready: false, label: 'Toolchain not set up' }
  )
}

export function Setup(): React.JSX.Element {
  const { actions } = useApp()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [busy, setBusy] = useState<null | 'wsl' | 'install' | 'test'>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restartNeeded, setRestartNeeded] = useState(false)
  const autoStarted = useRef(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    const s = await window.wax.toolchain.status()
    setStatus(s)
    refreshToolchainLabel(s)
    return s
  }, [])

  useEffect(() => {
    const off = window.wax.on('setup-progress', (line: string) => setLog((l) => [...l.slice(-300), line]))
    void refresh()
    return off
  }, [refresh])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])

  const install = useCallback(
    async (wslVersion: 1 | 2) => {
      setBusy('install')
      setError('')
      setLog([])
      try {
        const s = await window.wax.toolchain.install(wslVersion)
        setStatus(s)
        refreshToolchainLabel(s)
      } catch (e) {
        setError(errorText(e))
      } finally {
        setBusy(null)
      }
    },
    []
  )

  // Row 3 runs by itself once WSL is ready and nothing is installed yet.
  useEffect(() => {
    if (!status || autoStarted.current || busy) return
    if (status.windows.ok && status.wsl.ok && !status.toolchain.ok && status.partsAvailable && !status.toolchain.state) {
      autoStarted.current = true
      void install(2)
    }
  }, [status, busy, install])

  const enableWsl = async (compat: boolean): Promise<void> => {
    setBusy('wsl')
    setError('')
    setNotice('')
    try {
      const r = await window.wax.toolchain.enableWsl(compat)
      if (r.ok) {
        setRestartNeeded(true)
        setNotice(r.message)
      } else setError(r.message)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setError('')
    setLog([])
    try {
      const s = await window.wax.toolchain.testBuild()
      setStatus(s)
      refreshToolchainLabel(s)
    } catch (e) {
      setError(errorText(e))
      void refresh()
    } finally {
      setBusy(null)
    }
  }

  const s = status
  // The action of the first step that is not done is the primary button.
  const firstOpen = !s ? '' : !s.windows.ok ? 'Windows' : !s.wsl.ok ? 'WSL' : !s.toolchain.ok ? 'Toolchain' : !s.testBuild.ok ? 'Test build' : ''
  const kind = (row: string): string => (row === firstOpen ? 'btn primary' : 'btn')
  const rows: { name: string; desc: string; state: RowState; action?: React.ReactNode }[] = s
    ? [
        {
          name: 'Windows',
          desc: s.windows.detail,
          state: s.windows.ok ? 'ok' : 'bad'
        },
        {
          name: 'WSL',
          desc: s.wsl.ok
            ? s.wsl.detail
            : 'Windows Subsystem for Linux runs the compiler. Windows will ask for administrator permission once, download WSL (internet needed), then needs a restart.',
          state: busy === 'wsl' ? 'busy' : s.wsl.ok ? 'ok' : 'bad',
          action: !s.wsl.ok && (
            <div className="setup-actions">
              {restartNeeded ? (
                <button className={kind('WSL')} onClick={() => void window.wax.toolchain.restartComputer()}>
                  Restart now
                </button>
              ) : (
                <button className={kind('WSL')} disabled={!!busy || !s.windows.ok} onClick={() => void enableWsl(false)}>
                  Enable WSL
                </button>
              )}
            </div>
          )
        },
        {
          name: 'Toolchain',
          desc: s.toolchain.ok
            ? s.toolchain.detail
            : !s.partsAvailable
              ? 'The toolchain parts are not part of this build of the app.'
              : `${s.toolchain.detail} Installs WAX CDT and the editor engine into a private WSL distribution. No download, no administrator rights; one to two minutes.`,
          state: busy === 'install' ? 'busy' : s.toolchain.ok ? 'ok' : s.wsl.ok ? 'bad' : 'waiting',
          action: s.wsl.ok && s.partsAvailable && (
            <div className="setup-actions">
              <button className={kind('Toolchain')} disabled={!!busy} onClick={() => void install(2)}>
                {s.toolchain.state ? 'Repair toolchain' : 'Install toolchain'}
              </button>
              {!s.toolchain.ok && (
                <button
                  className="btn"
                  disabled={!!busy}
                  title="For computers where virtualization is turned off"
                  onClick={() => void install(1)}
                >
                  Use compatibility mode (WSL 1)
                </button>
              )}
            </div>
          )
        },
        {
          name: 'Test build',
          desc: s.testBuild.ok ? s.testBuild.detail : 'Builds the sample contract and checks that the editor engine answers.',
          state: busy === 'test' ? 'busy' : s.testBuild.ok ? 'ok' : s.toolchain.ok ? 'bad' : 'waiting',
          action: s.toolchain.ok && (
            <button className={kind('Test build')} disabled={!!busy} onClick={() => void test()}>
              Run test build
            </button>
          )
        }
      ]
    : []

  const allOk = !!s && s.windows.ok && s.wsl.ok && s.toolchain.ok && s.testBuild.ok

  return (
    <div className="page-scroll">
      <div className="form-page wide">
        <h1>Setup</h1>
        <p className="lead">
          WAX Master builds contracts with WAX CDT inside a private Linux environment (WSL). These steps prepare it once.
        </p>
        {!s && <div className="hint">Checking...</div>}
        <div className="setup-rows card">
          {rows.map((r) => (
            <div key={r.name} className="setup-row">
              <div className={`setup-icon ${r.state}`}>{r.state === 'ok' ? <IconCheck size={14} /> : r.state === 'busy' ? '…' : r.state === 'bad' ? '!' : ''}</div>
              <div className="setup-text">
                <div className="setup-name">{r.name}</div>
                <div className="setup-desc">{r.desc}</div>
              </div>
              {r.action && <div className="setup-actions">{r.action}</div>}
            </div>
          ))}
        </div>
        {notice && <div className="banner">{notice} After the restart, open WAX Master again; setup continues here.</div>}
        {error && <div className="error-text">{error}</div>}
        {log.length > 0 && (
          <div className="setup-log" ref={logRef}>
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
        <div className="button-row">
          {allOk ? (
            <button className="btn primary" onClick={() => actions.setView('home')}>
              Done
            </button>
          ) : (
            <button
              className="btn"
              disabled={!!busy}
              onClick={() => {
                void actions.updateSettings({ setupDismissed: true })
                actions.setView('home')
              }}
            >
              Skip
            </button>
          )}
          <button className="btn" disabled={!!busy} onClick={() => void refresh()}>
            Check again
          </button>
        </div>
        {s?.toolchain.ok && <ToolchainManager busy={!!busy} onBusy={(b) => setBusy(b ? 'install' : null)} />}
        {!allOk && (
          <div className="hint">
            Skipping keeps editing, chain work and the terminal available; building and code intelligence stay off until setup is done (Help &gt; Setup).
          </div>
        )}
      </div>
    </div>
  )
}
