// Manage Keypairs (screenshots 11, 11b, 12): vault password, key list with
// labels and accounts, Create (Regenerate, Save), Import, reveal, delete,
// Export / Import vault. Private keys never come back to this window.

import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText, toast } from '../lib/toast'
import { vaultStore, refreshVault, withVault } from '../lib/vault'
import { passwordStrength } from './UnlockPrompt'
import { useStore } from '../lib/stores'

interface KeyEntry {
  id: string
  label: string
  publicKey: string
  created: number
}

interface KeyAccount {
  account: string
  permission: string
  key: string
}

export function KeysDialog({ onClose, filterAccount }: { onClose: () => void; filterAccount?: string | null }): React.JSX.Element {
  const vs = useStore(vaultStore)
  const [keys, setKeys] = useState<KeyEntry[]>([])
  const [accounts, setAccounts] = useState<KeyAccount[]>([])
  const [mode, setMode] = useState<null | 'create' | 'import' | 'import-vault'>(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<KeyEntry | null>(null)
  const [newPub, setNewPub] = useState('')

  const load = useCallback(async () => {
    try {
      const list = await window.wax.keys.list()
      setKeys(list)
      if (list.length) {
        window.wax.keys
          .accounts(list.map((k) => k.publicKey))
          .then(setAccounts)
          .catch(() => setAccounts([]))
      } else setAccounts([])
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    if (vs.exists) void load()
  }, [vs.exists, vs.unlocked, load])

  if (!vs.exists) return <CreateVault onClose={onClose} />

  const shown = filterAccount ? keys.filter((k) => accounts.some((a) => a.key === k.publicKey && a.account === filterAccount)) : keys

  return (
    <Modal
      size="l"
      name="manage-keypairs"
      title="Manage Keypairs"
      onClose={onClose}
      footer={
        <>
          <div className="left">
            <button
              className="btn primary"
              onClick={() => {
                setError('')
                // A locked vault is asked for in place; the dialog opens with the new key.
                withVault(() => window.wax.keys.newPending()).then(
                  (pub) => {
                    setNewPub(pub)
                    setMode('create')
                  },
                  (e) => setError(errorText(e))
                )
              }}
            >
              Create
            </button>
            <button className="btn" onClick={() => setMode('import')}>
              Import
            </button>
          </div>
          <button className="btn" onClick={() => void window.wax.keys.exportVault().then((ok) => ok && toast('Vault exported', 'The file is encrypted with your vault password.', 'success'))}>
            Export vault
          </button>
          <button className="btn" onClick={() => setMode('import-vault')}>
            Import vault
          </button>
          <button className="btn subtle" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="vault-line">
        {vs.unlocked ? (
          <>
            <span className="badge green">Unlocked</span> The vault locks on sleep, on Windows lock (Win+L), after inactivity and when the app closes.
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => void window.wax.keys.lock().then(refreshVault)}>
              Lock
            </button>
          </>
        ) : (
          <UnlockInline />
        )}
      </div>
      <div className="hint" style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}>
        Keep the owner keys of valuable accounts out of this app; use a dedicated permission for deploying and daily actions.
      </div>
      {filterAccount && (
        <div className="hint">
          Showing keys for <b>{filterAccount}</b> on the current network.
        </div>
      )}
      <table className="tx-table keys-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Public key</th>
            <th>Accounts (current network)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((k) => (
            <tr key={k.id}>
              <td className="key-label">
                <input
                  className="label-input"
                  defaultValue={k.label}
                  placeholder="label"
                  onBlur={(e) => e.target.value !== k.label && void window.wax.keys.setLabel(k.id, e.target.value).then(load)}
                />
              </td>
              <td className="mono-small">
                {k.publicKey}
              </td>
              <td className="key-accounts">
                {accounts
                  .filter((a) => a.key === k.publicKey)
                  .map((a) => (
                    <div key={`${a.account}@${a.permission}`} className="mono-small">
                      {a.account}@{a.permission}
                    </div>
                  ))}
                {!accounts.some((a) => a.key === k.publicKey) && '-'}
              </td>
              <td className="actions">
                <button className="btn subtle" onClick={() => void window.wax.keys.reveal(k.id)}>
                  Reveal
                </button>{' '}
                <button
                  className="btn subtle danger-text"
                  onClick={() => {
                    setMode(null)
                    setDeleting(k)
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {keys.length === 0 && <div className="hint">No keys yet. Create a new key or import the private key of a testnet account.</div>}
      {error && <div className="error-text">{error}</div>}
      {mode === 'create' && <CreateKey initial={newPub} onClose={() => (setMode(null), void load())} />}
      {mode === 'import' && <ImportKey onClose={() => (setMode(null), void load())} />}
      {mode === 'import-vault' && <ImportVault onClose={() => (setMode(null), void load())} />}
      {deleting && <DeleteKey entry={deleting} onClose={() => (setDeleting(null), void load())} />}
    </Modal>
  )
}

function CreateVault({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.wax.keys.create(a, b)
      await refreshVault()
      toast('Vault created', 'Export a backup from Manage Keypairs; there is no password recovery.', 'success')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      size="s"
      name="create-vault"
      title="Create the key vault"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || a.length < 10 || a !== b} onClick={() => void create()}>
            {busy ? 'Creating...' : 'Create vault'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Private keys are stored encrypted with this password. It is never stored and cannot be recovered: if you forget it, the
        keys in the vault are lost. At least 10 characters.
      </p>
      <div className="field">
        <label>Password</label>
        <input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} />
        <div className="hint">{passwordStrength(a)}</div>
      </div>
      <div className="field">
        <label>Password again</label>
        <input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
        {b && a !== b && <div className="hint">The two passwords are not the same.</div>}
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

export function UnlockInline({ onDone }: { onDone?: () => void }): React.JSX.Element {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unlock = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.wax.keys.unlock(pw)
      setPw('')
      await refreshVault()
      onDone?.()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', gap: 'var(--gap-row)', alignItems: 'center', width: '100%' }}>
      <span className="badge">Locked</span>
      <input
        className="input"
        style={{ flex: 1 }}
        type="password"
        placeholder="Vault password"
        value={pw}
        autoFocus
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void unlock()}
      />
      <button className="btn primary" disabled={!pw || busy} onClick={() => void unlock()}>
        {busy ? 'Unlocking...' : 'Unlock'}
      </button>
      {error && <span className="error-text inline">{error}</span>}
    </div>
  )
}

function CreateKey({ initial, onClose }: { initial: string; onClose: () => void }): React.JSX.Element {
  const [pub, setPub] = useState(initial)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const regen = useCallback(async () => {
    try {
      setPub(await withVault(() => window.wax.keys.newPending()))
    } catch (e) {
      setError(errorText(e))
    }
  }, [])
  const close = (): void => {
    void window.wax.keys.discardPending()
    onClose()
  }
  return (
    <Modal
      size="m"
      name="create-keypair"
      title="Create Keypair"
      onClose={close}
      footer={
        <>
          <div className="left">
            <button className="btn" onClick={() => void regen()}>
              Regenerate
            </button>
          </div>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!pub}
            onClick={async () => {
              try {
                await withVault(() => window.wax.keys.savePending(label))
                toast('Key saved', pub, 'success')
                onClose()
              } catch (e) {
                setError(errorText(e))
              }
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label>Private</label>
        <div className="chip">••••••••••••••••••••••••••••••••••• (hidden; use Reveal after saving)</div>
      </div>
      <div className="field">
        <label>Public</label>
        <div className="chip" style={{ userSelect: 'text' }}>{pub}</div>
      </div>
      <div className="field">
        <label>Label</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. deploy key" />
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

function ImportKey({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal
      size="m"
      name="import-keypair"
      title="Import Keypair"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!key.trim()}
            onClick={async () => {
              try {
                const e = await withVault(() => window.wax.keys.import(key, label))
                setKey('')
                toast('Key imported', `${e.publicKey}\nClear your clipboard if you pasted the key.`, 'success')
                onClose()
              } catch (e) {
                setError(errorText(e))
              }
            }}
          >
            Import
          </button>
        </>
      }
    >
      <div className="field">
        <label>Private key (5... or PVT_K1_...)</label>
        <input className="input mono" type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} />
      </div>
      <div className="field">
        <label>Label</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

function ImportVault({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal
      size="s"
      name="import-vault"
      title="Import vault"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!pw}
            onClick={async () => {
              try {
                const n = await withVault(() => window.wax.keys.importVault(pw))
                if (n === null) return
                toast('Vault imported', `${n} key(s) added.`, 'success')
                onClose()
              } catch (e) {
                setError(errorText(e))
              }
            }}
          >
            Choose file...
          </button>
        </>
      }
    >
      <div className="field">
        <label>Password of the vault file you import</label>
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

function DeleteKey({ entry, onClose }: { entry: KeyEntry; onClose: () => void }): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const word = 'delete'
  return (
    <Modal
      size="s"
      name="delete-key"
      title="Delete key"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn danger"
            disabled={typed !== word}
            onClick={async () => {
              await window.wax.keys.remove(entry.id)
              onClose()
            }}
          >
            Delete key
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        The private key of <span className="code-tag">{entry.publicKey}</span> ({entry.label || 'no label'}) is removed from the
        vault. Without a backup it cannot be recovered.
      </p>
      <div className="field">
        <label>
          Type <b>{word}</b> to confirm
        </label>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
    </Modal>
  )
}
