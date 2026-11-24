import { useEffect, useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { withVault } from '../lib/vault'
import { isUnlockCancelled } from '../../../shared/vault-locked'
import { CANCELLED_NOT_SENT, formLineClass, outcomeLine, type FormLine } from '../lib/tx-outcome'
import { AccountPicker, PermissionPicker } from './AccountPicker'
import { NoBackupLine, useNoBackupGate } from './BackupWarning'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

interface VaultKey {
  id: string
  label: string
  publicKey: string
}

function useVaultKeys(): VaultKey[] {
  const [keys, setKeys] = useState<VaultKey[]>([])
  useEffect(() => {
    window.wax.keys.list().then(setKeys).catch(() => setKeys([]))
  }, [])
  return keys
}

function KeyPicker({ value, onChange, keys }: { value: string; onChange: (v: string) => void; keys: VaultKey[] }): React.JSX.Element {
  return (
    <div className="key-picker">
      <select className="select" value={keys.some((k) => k.publicKey === value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">(paste a public key)</option>
        {keys.map((k) => (
          <option key={k.id} value={k.publicKey}>
            {k.label || 'unlabelled'} - {k.publicKey.slice(0, 18)}…
          </option>
        ))}
      </select>
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="PUB_K1_... or EOS..." />
    </div>
  )
}

export function CreateAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const keys = useVaultKeys()
  const sym = net?.symbol ?? 'WAX'
  const prec = net?.precision ?? 8
  const zero = `${(0).toFixed(prec)} ${sym}`
  const [creator, setCreator] = useState('')
  const [creatorPerm, setCreatorPerm] = useState('active')
  const [name, setName] = useState('')
  const [ownerKey, setOwnerKey] = useState('')
  const [activeKey, setActiveKey] = useState('')
  const [ram, setRam] = useState(4096)
  const [cpu, setCpu] = useState(zero)
  const [netStake, setNetStake] = useState(zero)
  const [transfer, setTransfer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState<FormLine | null>(null)
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  // The new name is checked to be free when the field is left.
  const [free, setFree] = useState<null | 'checking' | 'free' | 'taken' | { error: string }>(null)
  const checkFree = async (n: string): Promise<void> => {
    if (!NAME.test(n)) {
      setFree(null)
      return
    }
    setFree('checking')
    try {
      setFree((await window.wax.chain.accountExists(n)) ? 'taken' : 'free')
    } catch (e) {
      setFree({ error: errorText(e) })
    }
  }

  useEffect(() => {
    if (keys.length && !ownerKey) {
      setOwnerKey(keys[0].publicKey)
      setActiveKey(keys[0].publicKey)
    }
  }, [keys, ownerKey])

  const ok = NAME.test(creator) && NAME.test(name) && NAME.test(creatorPerm) && !!ownerKey && !!activeKey && free !== 'taken'
  const noBackup = useNoBackupGate()

  const create = async (): Promise<void> => {
    if (!(await noBackup.gate([ownerKey, activeKey]))) return
    setBusy(true)
    setLine(null)
    try {
      const r = await withVault(() =>
        window.wax.accounts.create({
          creator,
          creatorPermission: creatorPerm,
          name,
          ownerKey,
          activeKey,
          ramBytes: ram,
          stakeCpu: cpu,
          stakeNet: netStake,
          transfer
        })
      )
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Account created', name, 'success')
        emit('open-account-page', name)
      } else {
        // A cancel is a neutral note; a refusal is explained once, by the inspector below when it has the text.
        if (r.status === 'failed' && r.trace) setTrace(r.trace)
        setLine(outcomeLine(r, CANCELLED_NOT_SENT))
      }
    } catch (e) {
      setLine(isUnlockCancelled(e) ? { kind: 'note', text: CANCELLED_NOT_SENT } : { kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="create-account"
      help="createAccount"
      title={`Create Account on ${net?.name ?? ''}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn primary" disabled={!ok || busy} onClick={() => void create()}>
            {busy ? 'Waiting for confirmation...' : 'Create'}
          </button>
        </>
      }
    >
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 2 }}>
          <label>Creator (pays)</label>
          <AccountPicker mode="signer" value={creator} onChange={setCreator} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <PermissionPicker account={creator} value={creatorPerm} onChange={setCreatorPerm} />
        </div>
      </div>
      <div className="field">
        <label>New account name</label>
        <input
          className="input mono"
          value={name}
          onChange={(e) => {
            setName(e.target.value.trim().toLowerCase())
            setFree(null)
          }}
          onBlur={() => void checkFree(name)}
        />
        {free === null && <div className="hint">12 characters: a-z and 1-5; shorter names are premium.</div>}
        {free === 'checking' && <div className="acct-note">Checking the name...</div>}
        {free === 'free' && <div className="acct-note good">The name is free on {net?.name}.</div>}
        {free === 'taken' && <div className="acct-note bad">This name is taken on {net?.name}.</div>}
        {free && typeof free === 'object' && <div className="acct-note">Could not check the name: {free.error}</div>}
      </div>
      <div className="field">
        <label>Owner key</label>
        <KeyPicker value={ownerKey} onChange={setOwnerKey} keys={keys} />
        <NoBackupLine publicKey={ownerKey} />
      </div>
      <div className="field">
        <label>Active key</label>
        <KeyPicker value={activeKey} onChange={setActiveKey} keys={keys} />
        {activeKey !== ownerKey && <NoBackupLine publicKey={activeKey} />}
      </div>
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 1 }}>
          <label>RAM (bytes)</label>
          <input className="input" type="number" min={0} value={ram} onChange={(e) => setRam(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Stake CPU</label>
          <input className="input mono" value={cpu} onChange={(e) => setCpu(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Stake NET</label>
          <input className="input mono" value={netStake} onChange={(e) => setNetStake(e.target.value)} />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} /> Transfer the staked tokens to the new account
      </label>
      {line && <div className={formLineClass(line)}>{line.text}</div>}
      {trace && <InspectorBody t={trace} />}
      {noBackup.element}
    </Modal>
  )
}

export function ChangeKeyDialog({
  account,
  permission,
  currentKeys,
  vaultKeys,
  signOptions,
  threshold,
  others,
  onClose
}: {
  account: string
  permission: string
  /** The permission's keys (PUB_K1_ form). */
  currentKeys: string[]
  /** Those of currentKeys that are in the vault. */
  vaultKeys: string[]
  /** The permission itself first, then its parents. */
  signOptions: string[]
  threshold: number
  /** Short text of the linked accounts and waits (kept as they are). */
  others: string[]
  onClose: () => void
}): React.JSX.Element {
  const keys = useVaultKeys()
  const [oldKey, setOldKey] = useState(vaultKeys[0] ?? currentKeys[0] ?? '')
  const [newKey, setNewKey] = useState('')
  // The permission itself signs by default when the vault has its key; a parent is a choice.
  const [signWith, setSignWith] = useState(vaultKeys.length > 0 ? permission : (signOptions[1] ?? permission))
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState<FormLine | null>(null)
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  const noBackup = useNoBackupGate()
  const change = async (): Promise<void> => {
    if (!(await noBackup.gate([newKey]))) return
    setBusy(true)
    setLine(null)
    try {
      const r = await withVault(() => window.wax.accounts.changeKey({ account, permission, oldKey, newKey, signWith }))
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Key changed', `${account}@${permission}`, 'success')
      } else {
        // A cancel is a neutral note; a refusal is explained once, by the inspector below when it has the text.
        if (r.status === 'failed' && r.trace) setTrace(r.trace)
        setLine(outcomeLine(r, CANCELLED_NOT_SENT))
      }
    } catch (e) {
      setLine(isUnlockCancelled(e) ? { kind: 'note', text: CANCELLED_NOT_SENT } : { kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      size="m"
      name="change-key"
      help="changeKey"
      title={`Change key of ${account}@${permission}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn danger" disabled={!newKey || !oldKey || busy} onClick={() => void change()}>
            {busy ? 'Waiting for confirmation...' : 'Change key'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        One key of <b>{permission}</b> is replaced by the new key with the same weight; the threshold ({threshold}), the other keys
        {others.length > 0 ? `, the linked accounts and waits (${others.join(', ')})` : ''} stay as they are.
      </p>
      <div className="field">
        <label>Key to replace</label>
        <select className="select" value={oldKey} onChange={(e) => setOldKey(e.target.value)}>
          {currentKeys.map((k) => (
            <option key={k} value={k}>
              {k}
              {vaultKeys.includes(k) ? ' (in the vault)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>New key</label>
        <KeyPicker value={newKey} onChange={setNewKey} keys={keys} />
        <div className="hint">Make sure the new key's private part is in the vault or backed up; otherwise you lose control of this permission.</div>
        <NoBackupLine publicKey={newKey} />
      </div>
      <div className="field">
        <label>Sign the change with permission</label>
        <select className="select" value={signWith} onChange={(e) => setSignWith(e.target.value)}>
          {signOptions.map((p, i) => (
            <option key={p} value={p}>
              {p}
              {i === 0 ? ' (this permission)' : ' (parent)'}
            </option>
          ))}
        </select>
      </div>
      {line && <div className={formLineClass(line)}>{line.text}</div>}
      {trace && <InspectorBody t={trace} />}
      {noBackup.element}
    </Modal>
  )
}
