import { useCallback, useEffect, useState } from 'react'
import type { ToolchainInfo } from '../../../shared/api'
import { Modal } from './Modal'
import { errorText, toast } from '../lib/toast'

type Installed = ToolchainInfo & { isDefault: boolean }

export function useToolchains(): { list: Installed[]; defaultId: string; defaultLabel: string; reload: () => Promise<void> } {
  const [list, setList] = useState<Installed[]>([])
  const [defaultId, setDefaultId] = useState('')
  const [defaultLabel, setDefaultLabel] = useState('')
  const reload = useCallback(async () => {
    const r = await window.wax.toolchains.list()
    setList(r.installed)
    setDefaultId(r.defaultId)
    setDefaultLabel(r.defaultLabel)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { list, defaultId, defaultLabel, reload }
}

/** Manage toolchains: list, Add from file (hash shown and compared with the known list), Remove. */
export function ToolchainManager({ busy, onBusy }: { busy: boolean; onBusy: (b: boolean) => void }): React.JSX.Element {
  const { list, reload } = useToolchains()
  const [candidate, setCandidate] = useState<Awaited<ReturnType<typeof window.wax.toolchains.chooseFile>>>(null)
  const [error, setError] = useState('')

  const choose = async (): Promise<void> => {
    setError('')
    try {
      setCandidate(await window.wax.toolchains.chooseFile())
    } catch (e) {
      setError(errorText(e))
    }
  }

  const add = async (): Promise<void> => {
    if (!candidate) return
    const c = candidate
    setCandidate(null)
    onBusy(true)
    try {
      await window.wax.toolchains.add(c.token, 2)
      toast('Toolchain added', c.label, 'success')
    } catch (e) {
      setError(errorText(e))
    } finally {
      onBusy(false)
      void reload()
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <h2>Toolchains</h2>
      <table className="tx-table">
        <thead>
          <tr>
            <th>TOOLCHAIN</th>
            <th>COMPILER</th>
            <th>WSL</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.id}>
              <td style={{ cursor: 'default' }}>
                {t.label} {t.isDefault && <span className="badge green">default</span>}
              </td>
              <td className="mono-small" style={{ cursor: 'default' }}>
                {t.cdtVersion}
              </td>
              <td style={{ cursor: 'default' }}>{t.wslVersion}</td>
              <td style={{ cursor: 'default' }}>
                {!t.isDefault && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${t.label}? Projects that use it build with the default toolchain afterwards.`)) return
                      try {
                        await window.wax.toolchains.remove(t.id)
                      } catch (e) {
                        setError(errorText(e))
                      }
                      void reload()
                    }}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn green" disabled={busy || list.length === 0} onClick={() => void choose()}>
        Add from file...
      </button>
      <div className="hint">Add another CDT version from its .deb package (for example cdt_4.1.1-1_amd64.deb from the AntelopeIO releases page). It is installed next to the default toolchain, offline, from the bundled base parts.</div>
      {error && <div className="error-text">{error}</div>}
      {candidate && (
        <Modal
          title="Add toolchain"
          onClose={() => setCandidate(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCandidate(null)}>
                Cancel
              </button>
              <button className="btn green" onClick={() => void add()}>
                Install
              </button>
            </>
          }
        >
          <div className="field">
            <label>File</label>
            <div className="chip">{candidate.file}</div>
          </div>
          <div className="field">
            <label>SHA-256 ({candidate.size.toLocaleString()} bytes)</label>
            <div className="chip" style={{ userSelect: 'text' }}>{candidate.sha256}</div>
          </div>
          {candidate.known ? (
            <div className="c-done" style={{ fontSize: 14 }}>Known package: {candidate.known}</div>
          ) : (
            <div className="error-text">
              This hash is not on the list of known CDT packages. Install it only if you trust where the file came from.
            </div>
          )}
          <div className="hint">Installed as "{candidate.label}" ({candidate.id}).</div>
        </Modal>
      )}
    </div>
  )
}
