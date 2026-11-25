import { useEffect, useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { vaultStore, withVault } from '../lib/vault'
import { isUnlockCancelled } from '../../../shared/vault-locked'
import { changeKeyDefaults } from '../../../shared/permission-signers'
import { CANCELLED_NOT_SENT, formLineClass, outcomeLine, type FormLine } from '../lib/tx-outcome'
import { AccountPicker, PermissionPicker, refreshPickLists, usePickList } from './AccountPicker'
import { markNewAccount, scheduleReadsAfterSend } from '../pages/account/wallet-form'
import { NoBackupLine, useNoBackupGate } from './BackupWarning'
import { stakeProblem, stakeQuantity } from '../../../shared/wallet'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

interface VaultKey {
  id: string
  label: string
  publicKey: string
}

/** The vault's keys, read again whenever the vault changes (a key made in Manage Keypairs appears at once). */
export function useVaultKeys(): VaultKey[] {
  const [keys, setKeys] = useState<VaultKey[]>([])
  const vault = useStore(vaultStore)
  useEffect(() => {
    window.wax.keys.list().then(setKeys).catch(() => setKeys([]))
  }, [vault])
  return keys
}

export function KeyPicker({ value, onChange, keys }: { value: string; onChange: (v: string) => void; keys: VaultKey[] }): React.JSX.Element {
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

/**
 * The Create Account form: used by the dialog (Accounts menu) and by the
 * wallet's Create account section. Returns the fields, the state of the
 * Create button and the action that sends.
 */
export function useCreateAccountForm(initialCreator = '', initialName = ''): {
  body: React.JSX.Element
  ok: boolean
  busy: boolean
  create: () => Promise<void>
  /** Why the chosen creator cannot be signed for by the vault ('' when it can, or when the vault could not be checked). */
  signProblem: string
} {
  const net = useStore(networkStore).current
  const keys = useVaultKeys()
  const sym = net?.symbol ?? 'WAX'
  const prec = net?.precision ?? 8
  const zero = `${(0).toFixed(prec)} ${sym}`
  const [creator, setCreator] = useState(initialCreator)
  const [creatorPerm, setCreatorPerm] = useState('active')
  const [name, setName] = useState(initialName)
  const [ownerKey, setOwnerKey] = useState('')
  const [activeKey, setActiveKey] = useState('')
  const [ram, setRam] = useState(4096)
  const [cpu, setCpu] = useState(zero)
  const [netStake, setNetStake] = useState(zero)
  const [transfer, setTransfer] = useState(false)
  const [created, setCreated] = useState('')
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

  // A bare number is an amount of the network's core token, as in the Transfer form.
  const cpuQuantity = stakeQuantity(cpu, prec, sym)
  const netQuantity = stakeQuantity(netStake, prec, sym)
  const cpuProblem = stakeProblem(cpu, prec, sym)
  const netProblem = stakeProblem(netStake, prec, sym)
  const ok =
    NAME.test(creator) && NAME.test(name) && NAME.test(creatorPerm) && !!ownerKey && !!activeKey && free !== 'taken' && name !== created && !!cpuQuantity && !!netQuantity
  // The same list the pickers use: the permissions of the creator the vault can sign for.
  const { list } = usePickList()
  const creatorEntry = list?.entries.find((e) => e.account === creator)
  const signProblem =
    list && list.vaultChecked && NAME.test(creator) && NAME.test(creatorPerm) && !(creatorEntry?.signable ?? []).includes(creatorPerm)
      ? `The vault has no key that can sign for ${creator}@${creatorPerm}: import its key in Manage Keypairs, or choose another creator.`
      : ''
  const noBackup = useNoBackupGate()

  const create = async (): Promise<void> => {
    if (!cpuQuantity || !netQuantity) return
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
          stakeCpu: cpuQuantity,
          stakeNet: netQuantity,
          transfer
        })
      )
      if (r.status === 'sent') {
        setTrace(r.trace)
        setCreated(name)
        setFree('taken')
        toast('Account created', name, 'success')
        // The node may not have the new account yet: its page reads it again a few times.
        markNewAccount(name)
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

  const body = (
    <>
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
        {name !== '' && name === created && (
          <div className="acct-note good">{name} was created. Enter another name to create one more.</div>
        )}
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
        <div className="hint">
          A new key is created in Manage Keypairs; it then appears in both lists.{' '}
          <button type="button" className="btn subtle sm" onClick={() => emit('open-keys', null)}>
            Manage Keypairs
          </button>
        </div>
      </div>
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 1 }}>
          <label>RAM (bytes)</label>
          <input className="input" type="number" min={0} value={ram} onChange={(e) => setRam(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Stake CPU</label>
          <input className="input mono" value={cpu} onChange={(e) => setCpu(e.target.value)} />
          {cpuProblem && <div className="acct-note bad">{cpuProblem}</div>}
        </div>
        <div style={{ flex: 1 }}>
          <label>Stake NET</label>
          <input className="input mono" value={netStake} onChange={(e) => setNetStake(e.target.value)} />
          {netProblem && <div className="acct-note bad">{netProblem}</div>}
        </div>
      </div>
      <label className="field" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} /> Transfer the staked tokens to the new account
      </label>
      {line && <div className={formLineClass(line)}>{line.text}</div>}
      {trace && <InspectorBody t={trace} />}
      {noBackup.element}
    </>
  )
  return { body, ok, busy, create, signProblem }
}

export function CreateAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const { body, ok, busy, create } = useCreateAccountForm()
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
      {body}
    </Modal>
  )
}

export function ChangeKeyDialog({
  account,
  permission,
  currentKeys,
  vaultKeys,
  signOptions,
  canSign,
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
  /** The permissions the vault can sign with. */
  canSign: string[]
  threshold: number
  /** Short text of the linked accounts and waits (kept as they are). */
  others: string[]
  onClose: () => void
}): React.JSX.Element {
  const keys = useVaultKeys()
  // The permission itself signs when the vault can sign with it, else the nearest parent the vault
  // can sign with; with a lost key the key to replace is one that is not in the vault.
  const [start] = useState(() => changeKeyDefaults(permission, signOptions, (p) => canSign.includes(p), currentKeys, vaultKeys))
  const [oldKey, setOldKey] = useState(start.oldKey)
  const [newKey, setNewKey] = useState('')
  const [signWith, setSignWith] = useState(start.signWith)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
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
        // The keys this dialog was opened with are no longer the permission's keys.
        setChanged(true)
        toast('Key changed', `${account}@${permission}`, 'success')
        // The account page and the account lists of the pickers read again: at once, after 1.5 s and after 4 s.
        scheduleReadsAfterSend(
          (fn, ms) => setTimeout(fn, ms),
          (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
          () => {
            refreshPickLists()
            emit('account-refresh', account)
          },
          () => undefined
        )
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
          <button className="btn danger" disabled={!newKey || !oldKey || busy || changed} onClick={() => void change()}>
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
