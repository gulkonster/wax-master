import { useEffect, useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'

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
    <div style={{ display: 'flex', gap: 'var(--gap-row)' }}>
      <select className="select" style={{ flex: 1 }} value={keys.some((k) => k.publicKey === value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">(paste a public key)</option>
        {keys.map((k) => (
          <option key={k.id} value={k.publicKey}>
            {k.label || 'unlabelled'} - {k.publicKey.slice(0, 18)}…
          </option>
        ))}
      </select>
      <input className="input mono" style={{ flex: 2 }} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="PUB_K1_... or EOS..." />
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
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)

  useEffect(() => {
    if (keys.length && !ownerKey) {
      setOwnerKey(keys[0].publicKey)
      setActiveKey(keys[0].publicKey)
    }
  }, [keys, ownerKey])

  const ok = NAME.test(creator) && NAME.test(name) && NAME.test(creatorPerm) && !!ownerKey && !!activeKey

  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.accounts.create({
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
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Account created', name, 'success')
        emit('open-account-page', name)
      } else if (r.status === 'failed') {
        setError(r.error)
        if (r.trace) setTrace(r.trace)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="create-account"
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
          <label>Creator (pays; its key must be in the vault)</label>
          <input className="input mono" value={creator} onChange={(e) => setCreator(e.target.value.trim().toLowerCase())} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <input className="input mono" value={creatorPerm} onChange={(e) => setCreatorPerm(e.target.value.trim().toLowerCase())} />
        </div>
      </div>
      <div className="field">
        <label>New account name (12 characters a-z, 1-5; shorter names are premium)</label>
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} />
      </div>
      <div className="field">
        <label>Owner key</label>
        <KeyPicker value={ownerKey} onChange={setOwnerKey} keys={keys} />
      </div>
      <div className="field">
        <label>Active key</label>
        <KeyPicker value={activeKey} onChange={setActiveKey} keys={keys} />
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
      {error && <div className="error-text">{error}</div>}
      {trace && <InspectorBody t={trace} />}
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
  // B15: the permission itself signs by default when the vault has its key; a parent is a choice.
  const [signWith, setSignWith] = useState(vaultKeys.length > 0 ? permission : (signOptions[1] ?? permission))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  const change = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.accounts.changeKey({ account, permission, oldKey, newKey, signWith })
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Key changed', `${account}@${permission}`, 'success')
      } else if (r.status === 'failed') {
        setError(r.error)
        if (r.trace) setTrace(r.trace)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      size="m"
      name="change-key"
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
        One key of <b>{permission}</b> is replaced by the new key with the same weight. The threshold ({threshold}), the other keys
        {others.length > 0 ? `, the linked accounts and waits (${others.join(', ')})` : ''} stay as they are. The current permission is read again
        from the chain before the confirmation.
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
      {error && <div className="error-text">{error}</div>}
      {trace && <InspectorBody t={trace} />}
    </Modal>
  )
}
