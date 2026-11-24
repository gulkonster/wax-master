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
    <div style={{ display: 'flex', gap: 8 }}>
      <select className="select" style={{ flex: 1 }} value={keys.some((k) => k.publicKey === value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">(paste a public key)</option>
        {keys.map((k) => (
          <option key={k.id} value={k.publicKey}>
            {k.label || 'unlabelled'} - {k.publicKey.slice(0, 18)}…
          </option>
        ))}
      </select>
      <input className="input" style={{ flex: 2 }} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="PUB_K1_... or EOS..." />
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
      title={`Create Account on ${net?.name ?? ''}`}
      wide
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn green" disabled={!ok || busy} onClick={() => void create()}>
            {busy ? 'Waiting for confirmation...' : 'Create'}
          </button>
        </>
      }
    >
      <div className="field" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <label>Creator (pays; its key must be in the vault)</label>
          <input className="input" value={creator} onChange={(e) => setCreator(e.target.value.trim().toLowerCase())} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <input className="input" value={creatorPerm} onChange={(e) => setCreatorPerm(e.target.value.trim().toLowerCase())} />
        </div>
      </div>
      <div className="field">
        <label>New account name (12 characters a-z, 1-5; shorter names are premium)</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} />
      </div>
      <div className="field">
        <label>Owner key</label>
        <KeyPicker value={ownerKey} onChange={setOwnerKey} keys={keys} />
      </div>
      <div className="field">
        <label>Active key</label>
        <KeyPicker value={activeKey} onChange={setActiveKey} keys={keys} />
      </div>
      <div className="field" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label>RAM (bytes)</label>
          <input className="input" type="number" min={0} value={ram} onChange={(e) => setRam(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Stake CPU</label>
          <input className="input" value={cpu} onChange={(e) => setCpu(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Stake NET</label>
          <input className="input" value={netStake} onChange={(e) => setNetStake(e.target.value)} />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
  parent,
  currentKeys,
  accounts,
  waits,
  onClose
}: {
  account: string
  permission: string
  parent: string
  currentKeys: string[]
  accounts: { actor: string; permission: string; weight: number }[]
  waits: { waitSec: number; weight: number }[]
  onClose: () => void
}): React.JSX.Element {
  const keys = useVaultKeys()
  const [newKey, setNewKey] = useState('')
  const [signWith, setSignWith] = useState(permission === 'owner' ? 'owner' : parent || permission)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  const change = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.accounts.changeKey({
        account,
        permission,
        parent,
        signWith,
        newKey,
        keepAccounts: accounts.map((a) => ({ permission: { actor: a.actor, permission: a.permission }, weight: a.weight })),
        keepWaits: waits.map((w) => ({ wait_sec: w.waitSec, weight: w.weight }))
      })
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
      title={`Change key of ${account}@${permission}`}
      wide
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn red" disabled={!newKey || busy} onClick={() => void change()}>
            {busy ? 'Waiting for confirmation...' : 'Change key'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        The permission <b>{permission}</b> will be controlled by the new key only (threshold 1). Current keys:{' '}
        <span className="mono-small">{currentKeys.join(', ') || '(none)'}</span>
        {accounts.length > 0 && ' Linked accounts and waits are kept.'}
      </p>
      <div className="field">
        <label>New key</label>
        <KeyPicker value={newKey} onChange={setNewKey} keys={keys} />
        <div className="hint">Make sure the new key's private part is in the vault or backed up; otherwise you lose control of this permission.</div>
      </div>
      <div className="field">
        <label>Sign the change with permission</label>
        <input className="input" value={signWith} onChange={(e) => setSignWith(e.target.value.trim().toLowerCase())} />
      </div>
      {error && <div className="error-text">{error}</div>}
      {trace && <InspectorBody t={trace} />}
    </Modal>
  )
}
