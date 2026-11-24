// Manage Keypairs (screenshots 11, 11b, 12): vault password, key list with
// labels and accounts, Create (Regenerate, Save), Import, reveal, delete,
// Export / Import vault, key backups, change password and the recovery code.
// Private keys and the recovery code never come back to this window.

import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText, toast } from '../lib/toast'
import { vaultStore, refreshVault, withVault } from '../lib/vault'
import { CreateVaultText, PasswordHint, openForgotPassword } from './UnlockPrompt'
import { checkPassword } from '../../../shared/password'
import type { VaultKeyEntry } from '../../../shared/api'
import { useStore } from '../lib/stores'

type KeyEntry = VaultKeyEntry

interface KeyAccount {
  account: string
  permission: string
  key: string
}

type VaultAction = 'change-password' | 'new-code' | 'remove-code'

/** Export vault: one encrypted file with every key (opens with the password or the recovery code). */
function exportVault(): void {
  withVault(() => window.wax.keys.exportVault()).then(
    (ok) => ok && toast('Vault exported', 'The file is encrypted; it opens with the vault password or the recovery code.', 'success'),
    (e) => {
      const t = errorText(e)
      if (t) toast('Export vault', t, 'error')
    }
  )
}

export function KeysDialog({ onClose, filterAccount }: { onClose: () => void; filterAccount?: string | null }): React.JSX.Element {
  const vs = useStore(vaultStore)
  const [keys, setKeys] = useState<KeyEntry[]>([])
  const [accounts, setAccounts] = useState<KeyAccount[]>([])
  const [mode, setMode] = useState<null | 'create' | 'import' | 'import-vault' | 'backup-all' | VaultAction>(null)
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
  }, [vs.exists, vs.unlocked, vs.keys, vs.noBackup, load])

  const backUp = (k: KeyEntry): void => {
    setError('')
    window.wax.keys.backup(k.id).then(
      (r) => r === 'saved' && toast('Backup saved', k.label || k.publicKey, 'success'),
      (e) => setError(errorText(e))
    )
  }

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
          <button className="btn" onClick={exportVault}>
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
      <div className="vault-line">
        <span className="hint" style={{ marginTop: 0 }}>
          Vault: {vs.recovery ? 'has a recovery code' : 'no recovery code'}.
        </span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setMode('change-password')}>
          Change password
        </button>
        <button className="btn sm" onClick={() => setMode('new-code')}>
          New recovery code
        </button>
        {vs.recovery && (
          <button className="btn sm" onClick={() => setMode('remove-code')}>
            Remove recovery code
          </button>
        )}
      </div>
      {vs.noBackup > 0 && (
        <div className="banner warn" style={{ marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--gap-row)' }}>
          <span style={{ flex: 1 }}>
            {vs.noBackup} {vs.noBackup === 1 ? 'key exists' : 'keys exist'} only in this vault.
          </span>
          <button className="btn sm" onClick={() => setMode('backup-all')}>
            Back up...
          </button>
        </div>
      )}
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
                {k.backup === 'none' && <span className="badge warn">No backup</span>}
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
                <button className="btn subtle" onClick={() => backUp(k)}>
                  Back up
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
      {mode === 'backup-all' && (
        <BackupAll keys={keys.filter((k) => k.backup === 'none')} onBackUp={backUp} onClose={() => (setMode(null), void load())} />
      )}
      {(mode === 'change-password' || mode === 'new-code' || mode === 'remove-code') && (
        <VaultPasswordAction action={mode} onClose={() => (setMode(null), void refreshVault())} />
      )}
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
      toast('Vault created', 'Save the recovery code shown in the separate window.', 'success')
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
          <button className="btn primary" disabled={busy || !checkPassword(a).allowed || a !== b} onClick={() => void create()}>
            {busy ? 'Creating...' : 'Create vault'}
          </button>
        </>
      }
    >
      <CreateVaultText />
      <div className="field">
        <label>Password</label>
        <input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} />
        <PasswordHint password={a} />
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
      <button className="btn subtle sm" onClick={openForgotPassword}>
        Forgot password?
      </button>
      {error && <span className="error-text inline">{error}</span>}
    </div>
  )
}

/**
 * The second step of Create Keypair, "Back up this key": one of three choices
 * must be taken before it closes (no close button, no Escape).
 */
export function BackupStep({ entry, testKeys, onDone }: { entry: KeyEntry; testKeys?: boolean; onDone: () => void }): React.JSX.Element {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saveFile = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if ((await window.wax.keys.backup(entry.id)) === 'saved') onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const show = async (): Promise<void> => {
    setError('')
    try {
      await window.wax.keys.reveal(entry.id)
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <Modal size="m" name="backup-key" title="Back up this key">
      <p style={{ marginTop: 0 }}>
        The private key of <b>{entry.label || 'this key'}</b> exists only in this vault.
        {testKeys && ' These are test keys of WAX Testnet; a backup still keeps the test account usable.'}
      </p>
      <div className="mono-small" style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}>
        {entry.publicKey}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        <button className="btn" disabled={busy} onClick={() => void saveFile()}>
          {busy ? 'Waiting for the backup window...' : 'Save a backup file...'}
        </button>
        <button className="btn" disabled={busy} onClick={() => void show()}>
          Show the key so I can write it down
        </button>
        <button className="btn" disabled={busy} onClick={onDone}>
          Skip: I understand that losing the vault or its password loses this key
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

/** The banner's "Back up...": Export vault for all keys at once, or one key at a time. */
function BackupAll({ keys, onBackUp, onClose }: { keys: KeyEntry[]; onBackUp: (k: KeyEntry) => void; onClose: () => void }): React.JSX.Element {
  return (
    <Modal
      size="m"
      name="backup-all"
      title="Back up keys"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={exportVault}>
            Export vault...
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Export vault writes one encrypted file with every key; it opens with the vault password or the recovery code. Or back up one key
        at a time:
      </p>
      {keys.map((k) => (
        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-row)', marginTop: 'var(--sp-1)' }}>
          <b>{k.label || 'unlabelled'}</b>
          <span className="mono-small" style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {k.publicKey}
          </span>
          <button className="btn sm" onClick={() => onBackUp(k)}>
            Back up
          </button>
          <button className="btn sm" onClick={() => void window.wax.keys.reveal(k.id)}>
            Show key
          </button>
        </div>
      ))}
    </Modal>
  )
}

/** Change password, New recovery code, Remove recovery code: the password again (new codes are shown in a separate window). */
function VaultPasswordAction({ action, onClose }: { action: VaultAction; onClose: () => void }): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [leftAgain, setLeftAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = action === 'change-password'
  const title = change ? 'Change password' : action === 'new-code' ? 'New recovery code' : 'Remove recovery code'
  const ready = !!current && (!change || (checkPassword(next).allowed && next === again)) && !busy
  const run = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setError('')
    try {
      if (change) {
        await withVault(() => window.wax.keys.changePassword(current, next, again))
        toast('Password changed', 'Copies of the vault exported earlier still open with the old password.', 'success')
      } else if (action === 'new-code') {
        await withVault(() => window.wax.keys.newRecoveryCode(current))
      } else {
        await withVault(() => window.wax.keys.removeRecoveryCode(current))
      }
      setCurrent('')
      setNext('')
      setAgain('')
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      size="s"
      name="vault-password-action"
      title={title}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className={action === 'remove-code' ? 'btn danger' : 'btn primary'} disabled={!ready} onClick={() => void run()}>
            {title}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {change
          ? 'Copies of the vault exported earlier still open with the old password.'
          : action === 'new-code'
            ? 'The old code stops working. The new code is shown once in a separate window.'
            : 'Without a recovery code a forgotten password cannot be recovered.'}
      </p>
      <div className="field">
        <label>{change ? 'Current password' : 'Vault password'}</label>
        <input
          className="input"
          type="password"
          autoFocus
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
        />
      </div>
      {change && (
        <>
          <div className="field">
            <label>New password</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            <PasswordHint password={next} />
          </div>
          <div className="field">
            <label>New password again</label>
            <input
              className="input"
              type="password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              onBlur={() => setLeftAgain(true)}
              onKeyDown={(e) => e.key === 'Enter' && void run()}
            />
            {leftAgain && again && next !== again && <div className="hint">The two passwords are not the same.</div>}
          </div>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

function CreateKey({ initial, onClose }: { initial: string; onClose: () => void }): React.JSX.Element {
  const [pub, setPub] = useState(initial)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  // After Save: the backup step for the stored key.
  const [saved, setSaved] = useState<KeyEntry | null>(null)
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
  if (saved) return <BackupStep entry={saved} onDone={onClose} />
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
                const entry = await withVault(() => window.wax.keys.savePending(label))
                toast('Key saved', pub, 'success')
                setSaved(entry)
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
        <div className="chip">••••••••••••••••••••••••••••••••••• (hidden; the next step offers a backup)</div>
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
        <label>Password or recovery code of the vault file you import</label>
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
