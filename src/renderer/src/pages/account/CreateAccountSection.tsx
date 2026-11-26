// Create account: the Create Account form of the Accounts menu, with this
// account as the creator that pays. Name bids opens it with a won name filled in.

import { HelpButton } from '../../components/HelpButton'
import { useCreateAccountForm } from '../../components/AccountDialogs'
import { type WalletContext } from './common'
import { Busy } from '../../components/Busy'

export function CreateAccountSection({ ctx, initialName = '' }: { ctx: WalletContext; initialName?: string }): React.JSX.Element {
  const { body, ok, busy, create, signProblem } = useCreateAccountForm(ctx.view.name, initialName)
  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Create account</h3>
        <HelpButton place="walletCreateAccount" />
      </div>
      <p className="wallet-lead">Creates a new account: the creator pays its RAM and the stake, and the new account gets an owner key and an active key.</p>
      {initialName && (
        <div className="hint">
          {initialName} was won in Name bids. Only the account that won it can create it, so the creator must stay {ctx.view.name}.
        </div>
      )}
      <div className="wallet-form">
        {body}
        <div>
          <button className="btn primary" disabled={!ok || busy || !!signProblem} title={signProblem || undefined} onClick={() => void create()}>
            {busy ? <Busy text="Waiting for confirmation..." /> : 'Create'}
          </button>
        </div>
        {signProblem && <div className="acct-note">{signProblem}</div>}
      </div>
    </section>
  )
}
