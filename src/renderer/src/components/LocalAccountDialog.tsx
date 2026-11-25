// Network > Local Chain > New account: the local chain's own `eosio` account creates
// the account with 1 MiB of RAM, 100 WAX CPU and 100 WAX NET staked to it and 10,000 WAX. The user picks one
// key of the vault for owner and active; only its public form is used, so the vault need not be unlocked.

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText, toast } from '../lib/toast'
import { networkStore, refreshNetworks, selectNetwork } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { markNewAccount } from '../pages/account/wallet-form'
import { useVaultKeys } from './AccountDialogs'
import { NoBackupLine } from './BackupWarning'
import { LOCAL_CHAIN_NETWORK_ID } from '../../../shared/local-chain'

const NAME = /^[a-z1-5][a-z1-5.]{10}[a-z1-5]$/

export function LocalAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const nets = useStore(networkStore)
  const keys = useVaultKeys()
  const [running, setRunning] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [free, setFree] = useState<null | 'checking' | 'free' | 'taken' | { error: string }>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.wax.faucet.suggestName().then(setName)
    window.wax.localChain
      .status()
      .then((s) => setRunning(s.phase === 'running'))
      .catch(() => setRunning(false))
    return window.wax.localChain.onStatus((s) => setRunning(s.phase === 'running'))
  }, [])

  useEffect(() => {
    if (keys.length && !keys.some((k) => k.publicKey === key)) setKey(keys[0].publicKey)
  }, [keys, key])

  const nameOk = NAME.test(name)
  const checkFree = async (n: string): Promise<void> => {
    if (!NAME.test(n) || !running) {
      setFree(null)
      return
    }
    setFree('checking')
    try {
      setFree((await window.wax.localChain.accountExists(n)) ? 'taken' : 'free')
    } catch (e) {
      setFree({ error: errorText(e) })
    }
  }
  // The prefilled name is checked as soon as the chain is known to run.
  useEffect(() => {
    if (running && name && free === null) void checkFree(name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, name])

  const ok = !!running && nameOk && !!key && free !== 'taken' && free !== 'checking'

  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.localChain.createAccount({ name, publicKey: key })
      toast('Account created', `${r.account} on Local chain with 10,000 WAX.`, 'success')
      if (nets.current?.id !== LOCAL_CHAIN_NETWORK_ID) await selectNetwork(LOCAL_CHAIN_NETWORK_ID)
      else await refreshNetworks()
      // The node may not have the new account yet: its page reads it again a few times.
      markNewAccount(r.account)
      emit('open-account-page', r.account)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="local-account"
      help="localChain"
      title="New Account on Local chain"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn primary" disabled={!ok || busy} onClick={() => void create()}>
            {busy ? 'Creating...' : 'Create'}
          </button>
        </>
      }
    >
      <p>
        The local chain's own account creates it with 1 MB of RAM, 100 WAX staked for CPU, 100 WAX staked for NET and 10,000 WAX. Nothing is signed by
        you.
      </p>
      {running === false && <div className="acct-note bad">The local chain is not running. Start it in Network &gt; Local Chain.</div>}
      <div className="field">
        <label>New account name</label>
        <input
          className="input mono"
          value={name}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value.trim().toLowerCase())
            setFree(null)
          }}
          onBlur={() => void checkFree(name)}
        />
        {!nameOk && name !== '' && <div className="acct-note bad">The name must be 12 characters: a-z and 1-5.</div>}
        {nameOk && free === null && <div className="hint">12 characters: a-z and 1-5.</div>}
        {free === 'checking' && <div className="acct-note">Checking the name...</div>}
        {free === 'free' && <div className="acct-note good">The name is free on Local chain.</div>}
        {free === 'taken' && <div className="acct-note bad">This name is taken on Local chain.</div>}
        {free && typeof free === 'object' && <div className="acct-note">Could not check the name: {free.error}</div>}
      </div>
      <div className="field">
        <label>Key (owner and active)</label>
        <select className="select" value={key} disabled={busy || keys.length === 0} onChange={(e) => setKey(e.target.value)}>
          {keys.length === 0 && <option value="">(the vault has no key)</option>}
          {keys.map((k) => (
            <option key={k.id} value={k.publicKey}>
              {k.label || 'unlabelled'} - {k.publicKey.slice(0, 18)}…
            </option>
          ))}
        </select>
        <NoBackupLine publicKey={key} />
        <div className="hint">
          A new key is created in Manage Keypairs; it then appears in the list.{' '}
          <button type="button" className="btn subtle sm" onClick={() => emit('open-keys', null)}>
            Manage Keypairs
          </button>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
