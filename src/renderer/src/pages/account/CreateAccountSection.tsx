// Create account: the Create Account form of the Accounts menu, with this
// account as the creator that pays.

import { HelpButton } from '../../components/HelpButton'
import { useCreateAccountForm } from '../../components/AccountDialogs'
import { ViewOnlyLine, type WalletContext } from './common'

export function CreateAccountSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { body, ok, busy, create } = useCreateAccountForm(ctx.view.name)
  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Create account</h3>
        <HelpButton place="walletCreateAccount" />
      </div>
      <p className="wallet-lead">Creates a new account: the creator pays its RAM and the stake, and the new account gets an owner key and an active key.</p>
      <div className="wallet-form">
        {body}
        <div>
          <button className="btn primary" disabled={!ok || busy} onClick={() => void create()}>
            {busy ? 'Waiting for confirmation...' : 'Create'}
          </button>
        </div>
      </div>
      <ViewOnlyLine ctx={ctx} />
    </section>
  )
}
