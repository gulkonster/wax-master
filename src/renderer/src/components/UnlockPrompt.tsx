// The one place where the vault password is asked in the editor window: over
// the window the user is in, when an operation needs keys (withVault), from the
// status bar and from Accounts > Unlock Vault / Create Vault. After a correct
// password the operation that asked runs at once. "Forgot password?" opens the
// separate recovery window; when the vault is opened there, the operation runs
// too, and after a reset this prompt turns into "Create the vault".

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText, toast } from '../lib/toast'
import { refreshVault, unlockPromptStore, vaultStore } from '../lib/vault'
import { useStore } from '../lib/stores'
import { MIN_PASSWORD_LENGTH, checkPassword } from '../../../shared/password'

/** The text under a new-password field: nothing, too short, the weak-password warning (yellow) or "Good". */
export function PasswordHint({ password }: { password: string }): React.JSX.Element | null {
  const c = checkPassword(password)
  if (!c.text) return null
  return <div className={c.level === 'weak' ? 'hint warn-note' : 'hint'}>{c.text}</div>
}

/** The text of every "create the vault" form. */
export function CreateVaultText(): React.JSX.Element {
  return (
    <p style={{ marginTop: 0 }}>
      Private keys are stored encrypted with this password; at least {MIN_PASSWORD_LENGTH} characters. Next, a recovery code is shown
      once in a separate window: with it a forgotten password can be replaced. Keys you create here exist only in this vault until you
      back them up.
    </p>
  )
}

/** Opens the separate recovery window. */
export function openForgotPassword(): void {
  window.wax.keys.forgot().catch((e) => toast('Forgot password', errorText(e), 'error'))
}

/** Shows the prompt while a request is open. Rendered once, after every other dialog of the window. */
export function UnlockPromptHost(): React.JSX.Element | null {
  const req = useStore(unlockPromptStore)
  if (!req) return null
  return <UnlockPrompt onDone={req.done} forgot={openForgotPassword} />
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
  // Only a reset in the recovery window (the vault is gone) switches Unlock to Create.
  const [create, setCreate] = useState(!vs.exists)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [leftAgain, setLeftAgain] = useState(false)

  useEffect(() => {
    if (create || busy) return
    // Opened in the recovery window with the code: the operation goes on.
    if (vs.unlocked) onDone(true)
    else if (!vs.exists) {
      setCreate(true)
      setPw('')
      setError('')
    }
  }, [vs.unlocked, vs.exists, create, busy, onDone])

  const ready = create ? checkPassword(pw).allowed && pw === again : pw.length > 0
  const submit = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      if (create) {
        await window.wax.keys.create(pw, again)
        toast('Vault created', 'Save the recovery code shown in the separate window.', 'success')
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
      {create && <CreateVaultText />}
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
        {create && <PasswordHint password={pw} />}
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
