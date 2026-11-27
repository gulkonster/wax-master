// Local tokens (local chain only): the chain's own account sends test WAX to this account.
// Nothing is signed by the user; the main process signs as the chain's system account.

import { useState } from 'react'
import { HelpButton } from '../../components/HelpButton'
import { errorText, toast } from '../../lib/toast'
import { amountProblem, amountUnits, formatUnits } from '../../../../shared/wallet'
import type { WalletContext } from './common'

const DEFAULT_AMOUNT = '1000'
const PRECISION = 8

export function LocalTokensSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const units = amountUnits(amount, PRECISION)
  const valid = units !== null && units > 0n
  const problem = amount.trim() === '' ? '' : amountProblem(amount, PRECISION) || (valid ? '' : 'Enter an amount of WAX greater than 0.')

  const give = async (): Promise<void> => {
    if (units === null) return
    setError('')
    setBusy(true)
    try {
      await window.wax.localChain.giveTokens({ account: ctx.view.name, amount: amount.trim() })
      toast('Local tokens', `${formatUnits(units, PRECISION, 'WAX')} sent to ${ctx.view.name}.`, 'success')
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
        Sends WAX from the local chain's own account to {ctx.view.name}. These tokens exist only on this computer; nothing is signed by you.
      </p>
      <div className="field">
        <label htmlFor="lc-give-amount">Amount (WAX)</label>
        <input id="lc-give-amount" className="input" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {problem && <div className="acct-note bad">{problem}</div>}
      {error && <div className="error-text">{error}</div>}
      <div className="buy-ram-actions">
        <button className="btn primary" disabled={busy || !valid} onClick={() => void give()}>
          Give tokens
        </button>
      </div>
    </section>
  )
}
