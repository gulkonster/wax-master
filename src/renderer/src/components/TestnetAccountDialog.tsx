// Accounts > Create Testnet Account: the WAX Testnet faucet creates the account
// and its keys; the keys go into the vault in the main process. Nothing is shown
// before the user acts; a locked vault is asked for when Create is pressed.

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText } from '../lib/toast'
import { networkStore, selectNetwork, waxTestnetEntry } from '../lib/networks'
import { isWaxTestnet } from './FaucetButton'
import { WAX_TESTNET_CHAIN_ID } from '../../../shared/ram-market'
import { withVault } from '../lib/vault'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { BackupStep } from './KeysDialog'
import type { VaultKeyEntry } from '../../../shared/api'

export function TestnetAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const nets = useStore(networkStore)
  const net = nets.current
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [backupQueue, setBackupQueue] = useState<VaultKeyEntry[]>([])
  // Keyed on the WAX Testnet chain id: the user's own entry for that chain works too.
  const onTestnet = isWaxTestnet(net)
  const testnet = waxTestnetEntry(nets.list, WAX_TESTNET_CHAIN_ID)
  // The name is checked once the field was left or a button pressed.
  const [nameTouched, setNameTouched] = useState(false)
  const nameOk = /^[a-z1-5]{12}$/.test(name)

  useEffect(() => {
    void window.wax.faucet.suggestName().then(setName)
  }, [])

  const create = async (): Promise<void> => {
    setNameTouched(true)
    if (!nameOk) return
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const r = await withVault(() => window.wax.faucet.create(name))
      setMessage(r.message)
      if (r.ok && r.account) {
        setCreated(r.account)
        // The faucet's keys exist only in the vault: the backup step follows, one key at a time.
        const made = [r.ownerPublic, r.activePublic].filter((k): k is string => !!k)
        const list = await window.wax.keys.list().catch(() => [])
        setBackupQueue(list.filter((k) => k.backup === 'none' && made.includes(k.publicKey)))
      } else setFailed(true)
    } catch (e) {
      const text = errorText(e)
      setMessage(text)
      setFailed(text !== '')
    } finally {
      setBusy(false)
    }
  }

  const tokens = async (account: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.wax.faucet.tokens(account)
      setMessage(r.message)
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="testnet-account"
      help="testnetAccount"
      title="Create Testnet Account"
      onClose={busy ? undefined : onClose}
      footer={
        created ? (
          <>
            <div className="left">
              <button className="btn" disabled={busy} onClick={() => void tokens(created)}>
                Request test tokens
              </button>
            </div>
            <button className="btn" disabled={busy} onClick={onClose}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={() => {
                emit('open-account-page', created)
                onClose()
              }}
            >
              Open account
            </button>
          </>
        ) : (
          <>
            <div className="left">
              <button
                className="btn"
                disabled={busy || !onTestnet || !/^[a-z1-5.]{1,12}$/.test(name)}
                title="Ask the faucet for test tokens for an account that already exists under the name in the field"
                onClick={() => void tokens(name)}
              >
                Request tokens
              </button>
            </div>
            <button className="btn" disabled={busy} onClick={onClose}>
              Close
            </button>
            <button className="btn primary" disabled={busy || !onTestnet} onClick={() => void create()}>
              {busy ? 'Asking the faucet...' : 'Create account'}
            </button>
          </>
        )
      }
    >
      {!onTestnet && (
        <div className="acct-empty">
          <span className="grow">The faucet creates accounts on WAX Testnet; the current network is {net?.name ?? 'not set'}.</span>
          {testnet ? (
            <button className="btn" onClick={() => void selectNetwork(testnet.id).catch((e) => setMessage(errorText(e)))}>
              Switch to {testnet.name}
            </button>
          ) : (
            <span className="hint">WAX Testnet is not in the network list: Network &gt; Manage Networks &gt; Restore default networks.</span>
          )}
        </div>
      )}
      <p>The faucet service creates these keys and has seen them, so use the account for testing only; replace them with vault keys on the Account page (Change key).</p>
      {!created && (
        <div className="field">
          <label>Account name</label>
          <input className="input mono" value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} onBlur={() => setNameTouched(true)} />
          {nameTouched && !nameOk ? (
            <div className="acct-note bad">The name must be 12 characters: a-z and 1-5.</div>
          ) : (
            <div className="hint">12 characters: a-z and 1-5.</div>
          )}
        </div>
      )}
      {created && (
        <p>
          <b>{created}</b> was created on WAX Testnet; its owner and active keys are in your vault.
        </p>
      )}
      {message && <div className={failed ? 'error-text' : 'hint'} style={{ fontSize: 'var(--fs-body)' }}>{message}</div>}
      {failed && (
        <div className="hint" style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)' }}>
          An existing testnet account can create one with Accounts &gt; Create Account.
        </div>
      )}
      {backupQueue.length > 0 && <BackupStep entry={backupQueue[0]} testKeys onDone={() => setBackupQueue((q) => q.slice(1))} />}
    </Modal>
  )
}
