// Accounts > Create Testnet Account: the WAX Testnet faucet creates the account
// and its keys; the keys go into the vault in the main process.

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { vaultStore } from '../lib/vault'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'

const FAUCET = 'https://faucet.waxsweden.org'

export function TestnetAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const vault = useStore(vaultStore)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const onTestnet = net?.id === 'wax-testnet'

  useEffect(() => {
    void window.wax.faucet.suggestName().then(setName)
  }, [])

  const create = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const r = await window.wax.faucet.create(name)
      setMessage(r.message)
      if (r.ok && r.account) setCreated(r.account)
      else setFailed(true)
    } catch (e) {
      setMessage(errorText(e))
      setFailed(true)
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
      title="Create Testnet Account"
      wide
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          {created ? (
            <>
              <button className="btn" disabled={busy} onClick={() => void tokens(created)}>
                Request test tokens
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
              <button className="btn" disabled={busy || !onTestnet || !/^[a-z1-5.]{1,12}$/.test(name)} onClick={() => void tokens(name)}>
                Request tokens for this existing account
              </button>
              <button className="btn primary" disabled={busy || !onTestnet || !vault.unlocked || !/^[a-z1-5]{12}$/.test(name)} onClick={() => void create()}>
                {busy ? 'Asking the faucet...' : 'Create account'}
              </button>
            </>
          )}
        </>
      }
    >
      {!onTestnet && <div className="error-text">Switch to WAX Testnet first (Network menu).</div>}
      {onTestnet && !vault.unlocked && <div className="error-text">Unlock the vault first (Accounts &gt; Manage Keypairs).</div>}
      {!created && (
        <div className="field">
          <label>Account name (12 characters: a-z and 1-5)</label>
          <input className="input mono" value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} />
        </div>
      )}
      {created && (
        <p>
          <b>{created}</b> was created on WAX Testnet; its owner and active keys are in your vault.
        </p>
      )}
      <p className="hint" style={{ fontSize: 13, lineHeight: '20px' }}>
        These keys were created by the faucet service, which has seen them. Use this account for testing only. You can replace both keys
        with new vault keys on the Account page (Change key).
      </p>
      {message && <div className={failed ? 'error-text' : 'hint'} style={{ fontSize: 13 }}>{message}</div>}
      {failed && (
        <div className="hint" style={{ fontSize: 13, lineHeight: '20px' }}>
          The faucet ({FAUCET}/create_account and {FAUCET}/get_token) did not create the account. An existing testnet account can create one
          with Accounts &gt; Create Account.
        </div>
      )}
    </Modal>
  )
}
