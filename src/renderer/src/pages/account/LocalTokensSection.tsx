// Local tokens (local chain only): the chain's own account sends test WAX to this account.
// Nothing is signed by the user; the main process signs as the chain's system account.

import { useState } from 'react'
import { HelpButton } from '../../components/HelpButton'
import { errorText, toast } from '../../lib/toast'
import type { WalletContext } from './common'

const DEFAULT_AMOUNT = '1000'
const MAX_AMOUNT = 1_000_000

export function LocalTokensSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT

  const give = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      await window.wax.localChain.giveTokens({ account: ctx.view.name, amount: value })
      toast('Local tokens', `${value.toLocaleString('en-US')} WAX sent to ${ctx.view.name}.`, 'success')
      ctx.afterSend()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Local tokens</h3>
        <HelpButton place="localChain" />
      </div>
      <p className="wallet-lead">
        Sends WAX from the local chain's own account to {ctx.view.name}. These tokens exist only on this computer; nothing is signed by you. At most {MAX_AMOUNT.toLocaleString('en-US')} WAX at a time.
      </p>
      <div className="field">
        <label htmlFor="lc-give-amount">Amount (WAX)</label>
        <input id="lc-give-amount" className="input" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="buy-ram-actions">
        <button className="btn primary" disabled={busy || !valid} onClick={() => void give()}>
          Give tokens
        </button>
      </div>
    </section>
  )
}
