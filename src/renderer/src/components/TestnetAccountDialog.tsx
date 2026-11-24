// Accounts > Create Testnet Account: the WAX Testnet faucet creates the account
// and its keys; the keys go into the vault in the main process. Nothing is shown
// before the user acts; a locked vault is asked for when Create is pressed.

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText } from '../lib/toast'
import { networkStore, selectNetwork } from '../lib/networks'
import { withVault } from '../lib/vault'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'

const FAUCET = 'https://faucet.waxsweden.org'

export function TestnetAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const onTestnet = net?.id === 'wax-testnet'
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
      if (r.ok && r.account) setCreated(r.account)
      else setFailed(true)
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
      title="Create Testnet Account"
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
              <button className="btn primary" disabled={busy || !onTestnet} onClick={() => void create()}>
                {busy ? 'Asking the faucet...' : 'Create account'}
              </button>
            </>
          )}
        </>
      }
    >
      {!onTestnet && (
        <div className="acct-empty">
          <span className="grow">The faucet creates accounts on WAX Testnet; the current network is {net?.name ?? 'not set'}.</span>
          <button className="btn" onClick={() => void selectNetwork('wax-testnet').catch((e) => setMessage(errorText(e)))}>
            Switch to WAX Testnet
          </button>
        </div>
      )}
      {!created && (
        <div className="field">
          <label>Account name (12 characters: a-z and 1-5)</label>
          <input className="input mono" value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} onBlur={() => setNameTouched(true)} />
          {nameTouched && !nameOk && <div className="acct-note bad">The name must be 12 characters: a-z and 1-5.</div>}
        </div>
      )}
      {created && (
        <p>
          <b>{created}</b> was created on WAX Testnet; its owner and active keys are in your vault.
        </p>
      )}
      <p className="hint" style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)' }}>
        These keys were created by the faucet service, which has seen them. Use this account for testing only. You can replace both keys
        with new vault keys on the Account page (Change key).
      </p>
      {message && <div className={failed ? 'error-text' : 'hint'} style={{ fontSize: 'var(--fs-body)' }}>{message}</div>}
      {failed && (
        <div className="hint" style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)' }}>
          The faucet ({FAUCET}/create_account and {FAUCET}/get_token) did not create the account. An existing testnet account can create one
          with Accounts &gt; Create Account.
        </div>
      )}
    </Modal>
  )
}
