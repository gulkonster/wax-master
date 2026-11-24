// Testnet faucet (WAX Testnet chain only): asks the faucet service to send test
// tokens to this account. Nothing is signed; the service decides the amount.

import { FaucetButton } from '../../components/FaucetButton'
import { HelpButton } from '../../components/HelpButton'
import type { WalletContext } from './common'

export function FaucetSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Testnet faucet</h3>
        <HelpButton place="walletFaucet" />
      </div>
      <p className="wallet-lead">
        Asks the WAX Testnet faucet to send test tokens to {ctx.view.name}. The service decides the amount and how often it pays; nothing is signed here.
      </p>
      <div className="buy-ram-actions">
        <FaucetButton account={ctx.view.name} primary onDone={() => setTimeout(ctx.reload, 3000)} />
      </div>
    </section>
  )
}
