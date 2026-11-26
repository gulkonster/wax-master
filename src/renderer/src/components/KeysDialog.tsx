// Manage Keypairs (screenshots 11, 11b, 12): a header with the vault state and
// the Vault menu (lock, export, import, change password, recovery code), one
// note, the key list (label and tags, the public key on one line, the accounts
// of the current network, Show private key, Back up and a menu with Rename and
// Delete) and one footer row: Create, Import, Close.
// Private keys and the recovery code never come back to this window.

import { useCallback, useEffect, useRef, useState } from 'react'
import { InputDialog, Modal } from './Modal'
import { errorText, toast } from '../lib/toast'
import { copyText } from '../lib/clipboard'
import { networkStore } from '../lib/networks'
import { vaultStore, refreshVault, withVault, askUnlock } from '../lib/vault'
import { CreateVaultText, PasswordHint } from './UnlockPrompt'
import { checkPassword } from '../../../shared/password'
import type { VaultKeyEntry } from '../../../shared/api'
import { useStore } from '../lib/stores'
import { IconCheck, IconChevronDown, IconCopy, IconLock, IconMore } from './Icons'
import { Busy } from './Busy'

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

/** Where a menu opens: under its button, right edges aligned, on the page (the dialog does not clip it). */
function placeMenu(el: HTMLElement | null): React.CSSProperties | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  const below = window.innerHeight - r.bottom
  const style: React.CSSProperties = { right: window.innerWidth - r.right }
  if (below < r.top && below < window.innerHeight / 3) {
    style.top = 'auto'
    style.bottom = window.innerHeight - r.top
    style.maxHeight = r.top
  } else {
    style.top = r.bottom
    style.maxHeight = below
  }
  return style
}

/** A button that opens a menu; the menu closes on a click outside, on a pick and when the list scrolls. */
function MenuButton({
  button,
  className,
  title,
  children
}: {
  button: React.ReactNode
  className: string
  title?: string
  children: (close: () => void) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const scrolled = (e: Event): void => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', outside)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])
  return (
    <>
      <button ref={btnRef} className={`${className}${open ? ' open' : ''}`} title={title} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div ref={menuRef} className="dropdown keys-menu" role="menu" style={placeMenu(btnRef.current)}>
          {children(close)}
        </div>
      )}
    </>
  )
}

/** One menu entry. */
function MenuItem({
  label,
  onPick,
  close,
  disabled,
  danger
}: {
  label: string
  onPick: () => void
  close: () => void
  disabled?: boolean
  danger?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`dd-item${disabled ? ' disabled' : ''}${danger ? ' danger' : ''}`}
      role="menuitem"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return
        close()
        onPick()
      }}
    >
      <span className="dd-label">{label}</span>
    </div>
  )
}

/** The text of a key's backup state, for the tag's tooltip. */
function backupText(k: KeyEntry): string {
  switch (k.backup) {
    case 'none':
      return 'This key exists only in this vault.'
    case 'file':
      return 'Backed up to a file.'
    case 'shown':
      return 'The private key was shown for writing down.'
    case 'imported':
      return 'Imported: a copy exists where it came from.'
    case 'vault-export':
      return 'Included in an exported vault file.'
  }
}

export function KeysDialog({ onClose, filterAccount }: { onClose: () => void; filterAccount?: string | null }): React.JSX.Element {
  const vs = useStore(vaultStore)
  const net = useStore(networkStore).current
  const [keys, setKeys] = useState<KeyEntry[]>([])
  const [accounts, setAccounts] = useState<KeyAccount[]>([])
  const [mode, setMode] = useState<null | 'create' | 'import' | 'import-vault' | 'backup-all' | VaultAction>(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<KeyEntry | null>(null)
  const [renaming, setRenaming] = useState<KeyEntry | null>(null)
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

  const reveal = (k: KeyEntry): void => {
    setError('')
    window.wax.keys.reveal(k.id).catch((e) => setError(errorText(e)))
  }

  const copyKey = (k: KeyEntry): void => {
    copyText(k.publicKey).then(
      () => toast('Public key copied', k.publicKey, 'success'),
      (e) => toast('Copy', errorText(e), 'error')
    )
  }

  const create = (): void => {
    setError('')
    // A locked vault is asked for in place; the dialog opens with the new key.
    withVault(() => window.wax.keys.newPending()).then(
      (pub) => {
        setNewPub(pub)
        setMode('create')
      },
      (e) => setError(errorText(e))
    )
  }

  if (!vs.exists) return <CreateVault onClose={onClose} />

  const shown = filterAccount ? keys.filter((k) => accounts.some((a) => a.key === k.publicKey && a.account === filterAccount)) : keys
  const netName = net?.name ?? 'no network'

  const header = (
    <div className="keys-head">
      <span className="keys-title">Manage Keypairs</span>
      <div className="keys-state">
        {vs.unlocked ? (
          <span className="badge green" title="The vault locks on sleep, on Windows lock (Win+L), after inactivity and when the app closes.">
            <IconCheck size="xs" />
            Unlocked
          </span>
        ) : (
          <>
            <span className="badge">
              <IconLock size="xs" />
              Locked
            </span>
            <button className="btn" onClick={() => void askUnlock()}>
              Unlock
            </button>
          </>
        )}
        <MenuButton
          className="btn"
          title="Vault: lock, export, import, password and recovery code"
          button={
            <>
              Vault
              <IconChevronDown size="sm" />
            </>
          }
        >
          {(close) => (
            <>
              <MenuItem label="Lock" close={close} disabled={!vs.unlocked} onPick={() => void window.wax.keys.lock().then(refreshVault)} />
              <div className="dd-sep" />
              <MenuItem label="Export vault..." close={close} onPick={exportVault} />
              <MenuItem label="Import vault..." close={close} onPick={() => setMode('import-vault')} />
              <div className="dd-sep" />
              <MenuItem label="Change password..." close={close} onPick={() => setMode('change-password')} />
              <MenuItem label="New recovery code..." close={close} onPick={() => setMode('new-code')} />
              <MenuItem label="Remove recovery code..." close={close} disabled={!vs.recovery} onPick={() => setMode('remove-code')} />
              <div className="dd-note">{vs.recovery ? 'The vault has a recovery code.' : 'The vault has no recovery code.'}</div>
            </>
          )}
        </MenuButton>
      </div>
    </div>
  )

  return (
    <Modal
      size="l"
      name="manage-keypairs"
      help="manageKeypairs"
      title={header}
      onClose={onClose}
      footer={
        <>
          <div className="left">
            <button className="btn primary" onClick={create}>
              Create
            </button>
            <button className="btn" onClick={() => setMode('import')}>
              Import
            </button>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <p className="keys-note">Private keys are stored encrypted on this computer; they are shown only in a separate window after the password.</p>
      {vs.noBackup > 0 && (
        <div className="banner warn keys-banner">
          <span>
            {vs.noBackup} {vs.noBackup === 1 ? 'key exists' : 'keys exist'} only in this vault.
          </span>
          <button className="btn sm" onClick={() => setMode('backup-all')}>
            Back up...
          </button>
        </div>
      )}
      {keys.length === 0 ? (
        <div className="keys-empty">No keys yet: create a new key, or import the private key of a testnet account.</div>
      ) : (
        <>
          <div className="keys-caption">
            {filterAccount ? (
              <>
                Keys of <span className="mono">{filterAccount}</span> · accounts on {netName}
              </>
            ) : (
              <>
                {keys.length} {keys.length === 1 ? 'key' : 'keys'} · accounts on {netName}
              </>
            )}
          </div>
          <div className="keys-list" role="list">
            {shown.map((k) => {
              const own = accounts.filter((a) => a.key === k.publicKey)
              return (
                <div key={k.id} className="key-row" role="listitem">
                  <div className="key-main">
                    <div className="key-label-line">
                      {k.label ? <span className="key-label">{k.label}</span> : <span className="key-label none">No label</span>}
                      {k.backup === 'none' && (
                        <span className="badge warn" title={backupText(k)}>
                          No backup
                        </span>
                      )}
                    </div>
                    <div className="key-pub">
                      <span className="key-pub-text" title={k.publicKey}>
                        {k.publicKey}
                      </span>
                      <button className="icon-btn small" title="Copy public key" onClick={() => copyKey(k)}>
                        <IconCopy size="xs" />
                      </button>
                    </div>
                    {own.length > 0 && (
                      <div className="key-accts">
                        <span className="key-accts-title">Accounts</span>
                        {own.map((a) => (
                          <span key={`${a.account}@${a.permission}`} className="badge mono">
                            {a.account}@{a.permission}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="key-actions">
                    <button className="btn" onClick={() => reveal(k)}>
                      Show private key
                    </button>
                    <button className="btn" onClick={() => backUp(k)}>
                      Back up
                    </button>
                    <MenuButton className="icon-btn key-more" title="More: rename, delete" button={<IconMore />}>
                      {(close) => (
                        <>
                          <MenuItem label="Rename..." close={close} onPick={() => setRenaming(k)} />
                          <MenuItem
                            label="Delete..."
                            close={close}
                            danger
                            onPick={() => {
                              setMode(null)
                              setDeleting(k)
                            }}
                          />
                        </>
                      )}
                    </MenuButton>
                  </div>
                </div>
              )
            })}
            {shown.length === 0 && <div className="keys-empty">No key of this vault belongs to {filterAccount} on {netName}.</div>}
          </div>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
      {mode === 'create' && <CreateKey initial={newPub} onClose={() => (setMode(null), void load())} />}
      {mode === 'import' && <ImportKey onClose={() => (setMode(null), void load())} />}
      {mode === 'import-vault' && <ImportVault onClose={() => (setMode(null), void load())} />}
      {deleting && <DeleteKey entry={deleting} onClose={() => (setDeleting(null), void load())} />}
      {renaming && (
        <InputDialog
          title="Rename key"
          help="manageKeypairs"
          label="Label"
          initial={renaming.label}
          okLabel="Rename"
          onOk={async (v) => {
            await window.wax.keys.setLabel(renaming.id, v)
            await load()
          }}
          onClose={() => setRenaming(null)}
        />
      )}
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
      help="vault"
      title="Create the key vault"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !checkPassword(a).allowed || a !== b} onClick={() => void create()}>
            {busy ? <Busy text="Creating..." /> : 'Create vault'}
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
    <Modal size="m" name="backup-key" help="keyBackup" title="Back up this key">
      <p style={{ marginTop: 0 }}>
        The private key of <b>{entry.label || 'this key'}</b> exists only in this vault.
        {testKeys && ' These are test keys of WAX Testnet; a backup still keeps the test account usable.'}
      </p>
      <div className="mono-small" style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}>
        {entry.publicKey}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        <button className="btn" disabled={busy} onClick={() => void saveFile()}>
          {busy ? <Busy text="Waiting for the backup window..." /> : 'Save a backup file...'}
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
      help="keyBackup"
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

/** The note of Change password; it names the kept older vault files when the data folder holds any. */
function changePasswordNote(keptCopies: number): string {
  return keptCopies > 0
    ? 'Copies of the vault exported earlier, and the kept files vault.v1.bak.json / vault-old-<date>.json in the data folder, still open with their old password.'
    : 'Copies of the vault exported earlier still open with the old password.'
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
  const vs = useStore(vaultStore)
  const passwordNote = changePasswordNote(vs.keptCopies)
  const title = change ? 'Change password' : action === 'new-code' ? 'New recovery code' : 'Remove recovery code'
  const ready = !!current && (!change || (checkPassword(next).allowed && next === again)) && !busy
  const run = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setError('')
    try {
      if (change) {
        await withVault(() => window.wax.keys.changePassword(current, next, again))
        toast('Password changed', passwordNote, 'success')
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
      help="vault"
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
          ? passwordNote
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
      help="manageKeypairs"
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
      help="manageKeypairs"
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
      help="vault"
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
        <div className="hint">For a copy of this vault, use its password.</div>
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
      help="keyBackup"
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
