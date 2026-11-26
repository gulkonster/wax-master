// "Request testnet tokens": asks the WAX Testnet faucet to send test tokens to
// an account. Shown only on the WAX Testnet chain. The service's own message is
// shown as it came; a refusal (the service limits how often it pays) is plain
// text, not an error of the program. The amount is whatever the service sends.

import { useState } from 'react'
import type { NetworkInfo } from '../../../shared/chain-types'
import { WAX_TESTNET_CHAIN_ID } from '../../../shared/ram-market'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { errorText } from '../lib/toast'
import { Busy } from './Busy'

export function isWaxTestnet(net: NetworkInfo | null | undefined): boolean {
  return net?.chainId === WAX_TESTNET_CHAIN_ID
}

export function FaucetButton({
  account,
  primary,
  onDone
}: {
  account: string
  /** Drawn as the main button (when nobody can pay for the RAM). */
  primary?: boolean
  /** Called after the service answered, to refresh balances. */
  onDone?: (ok: boolean) => void
}): React.JSX.Element | null {
  const net = useStore(networkStore).current
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!isWaxTestnet(net)) return null

  const request = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    let ok = false
    try {
      const r = await window.wax.faucet.tokens(account)
      ok = r.ok
      setMessage(r.message || (r.ok ? 'Requested.' : 'The faucet did not send tokens.'))
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(false)
    }
    onDone?.(ok)
  }

  return (
    <span className="faucet-btn">
      <button className={`btn${primary ? ' primary' : ''}`} disabled={busy || !account} onClick={() => void request()}>
        {busy ? <Busy text="Asking the faucet..." /> : 'Request testnet tokens'}
      </button>
      {message && <span className="faucet-msg">{message}</span>}
    </span>
  )
}
