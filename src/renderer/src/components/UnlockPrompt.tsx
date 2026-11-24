// The one place where the vault password is asked in the editor window: over
// the window the user is in, when an operation needs keys (withVault), from the
// status bar and from Accounts > Unlock Vault / Create Vault. After a correct
// password the operation that asked runs at once.

import { useState } from 'react'
import { Modal } from './Modal'
import { errorText, toast } from '../lib/toast'
import { refreshVault, unlockPromptStore, vaultStore } from '../lib/vault'
import { useStore } from '../lib/stores'

/** The vault password rule of the main process (vault.ts MIN_PASSWORD_LENGTH). */
export const VAULT_PASSWORD_MIN = 10

export function passwordStrength(pw: string): string {
  if (!pw) return ''
  if (pw.length < VAULT_PASSWORD_MIN) return `Too short (${pw.length}/${VAULT_PASSWORD_MIN})`
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (pw.length >= 16 && kinds >= 3) return 'Strong'
  if (pw.length >= 12 && kinds >= 2) return 'Fair; longer is better'
  return 'Weak; use a longer password or a few unrelated words'
}

/** Shows the prompt while a request is open. Rendered once, after every other dialog of the window. */
export function UnlockPromptHost(): React.JSX.Element | null {
  const req = useStore(unlockPromptStore)
  if (!req) return null
  return <UnlockPrompt onDone={req.done} />
}

export function UnlockPrompt({
  onDone,
  forgot
}: {
  onDone: (unlocked: boolean) => void
  /** "Forgot password?" under the field; shown only when given. */
  forgot?: () => void
}): React.JSX.Element {
  const vs = useStore(vaultStore)
  // The mode is fixed when the prompt opens; creating the vault does not switch it to Unlock.
  const [create] = useState(!vs.exists)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [leftAgain, setLeftAgain] = useState(false)

  const ready = create ? pw.length >= VAULT_PASSWORD_MIN && pw === again : pw.length > 0
  const submit = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      if (create) {
        await window.wax.keys.create(pw, again)
        toast('Vault created', 'Export a backup from Manage Keypairs; there is no password recovery.', 'success')
      } else {
        await window.wax.keys.unlock(pw)
      }
      setPw('')
      setAgain('')
      await refreshVault()
      onDone(true)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  const cancel = (): void => {
    if (!busy) onDone(false)
  }

  return (
    <Modal
      size="s"
      name="unlock-vault"
      title={create ? 'Create the vault' : 'Unlock the vault to go on'}
      onClose={cancel}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? (create ? 'Creating...' : 'Unlocking...') : create ? 'Create vault' : 'Unlock'}
          </button>
        </>
      }
    >
      {create && (
        <p style={{ marginTop: 0 }}>
          Private keys are stored encrypted with this password. It is never stored and cannot be recovered: if you forget it, the keys
          in the vault are lost. At least {VAULT_PASSWORD_MIN} characters.
        </p>
      )}
      <div className="field">
        <label>{create ? 'Password' : 'Vault password'}</label>
        <input
          className="input"
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {create && <div className="hint">{passwordStrength(pw)}</div>}
        {!create && forgot && (
          <button className="btn subtle sm" style={{ marginTop: 'var(--sp-1)' }} onClick={forgot}>
            Forgot password?
          </button>
        )}
      </div>
      {create && (
        <div className="field">
          <label>Password again</label>
          <input
            className="input"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            onBlur={() => setLeftAgain(true)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          {leftAgain && again && pw !== again && <div className="hint">The two passwords are not the same.</div>}
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
