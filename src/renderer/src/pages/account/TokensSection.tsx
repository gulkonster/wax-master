// Tokens: the core token, the tokens the history service knows for the account,
// and tokens added by contract and symbol (kept per network). Each row has
// Transfer, which opens the Transfer section with that token.

import { useState } from 'react'
import type { TokenRow, WalletTokens } from '../../../../shared/chain-types'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText, toast } from '../../lib/toast'
import { HelpButton } from '../../components/HelpButton'
import { IconClose, IconRefresh } from '../../components/Icons'
import { NAME, ViewOnlyLine, type WalletContext } from './common'

const SYMBOL = /^[A-Z]{1,7}$/

export function TokensSection({
  ctx,
  tokens,
  error,
  reloadTokens,
  onTransfer
}: {
  ctx: WalletContext
  tokens: WalletTokens | null
  error: string
  reloadTokens: () => void
  onTransfer: (t: TokenRow) => void
}): React.JSX.Element {
  const net = useStore(networkStore).current
  const [adding, setAdding] = useState(false)
  const [contract, setContract] = useState('')
  const [symbol, setSymbol] = useState('')
  const [addError, setAddError] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async (): Promise<void> => {
    setAddError('')
    if (!NAME.test(contract)) return setAddError('Enter the token contract (an account name).')
    if (!SYMBOL.test(symbol)) return setAddError('Enter the symbol: 1 to 7 capital letters.')
    setBusy(true)
    try {
      await window.wax.wallet.addToken(contract, symbol)
      toast('Token added', `${symbol} (${contract})`, 'success')
      setContract('')
      setSymbol('')
      setAdding(false)
      reloadTokens()
    } catch (e) {
      setAddError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: TokenRow): Promise<void> => {
    try {
      await window.wax.wallet.removeToken(t.contract, t.symbol)
      reloadTokens()
    } catch (e) {
      toast('Could not remove the token', errorText(e), 'error')
    }
  }

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Tokens</h3>
        <HelpButton place="walletTransfers" />
        <span className="grow" />
        <button className="icon-btn" title="Refresh" onClick={reloadTokens}>
          <IconRefresh />
        </button>
      </div>
      <p className="wallet-lead">The tokens this account holds. Transfer sends one to another account.</p>
      {error && <div className="error-text">{error}</div>}
      {!tokens && !error && <div className="hint">Reading balances...</div>}
      {tokens && (
        <div className="card-list">
          <div className="token-row token-head">
            <span>Token</span>
            <span>Balance</span>
            <span />
          </div>
          {tokens.rows.map((t) => (
            <div key={`${t.contract}|${t.symbol}`} className="token-row">
              <span className="token-name">
                <span className="token-symbol-line">
                  <span className="token-symbol">{t.symbol}</span>
                  {t.mark && <span className={`badge${t.mark.kind === 'lookalike' ? ' warn' : ''}`}>{t.mark.text}</span>}
                </span>
                <span className="token-contract mono-small">{t.contract}</span>
              </span>
              <span className="num">{t.balance || 'could not be read'}</span>
              <span className="token-actions">
                <button className="btn" disabled={ctx.viewOnly} title={ctx.viewOnly ? ctx.reason : `Send ${t.symbol}`} onClick={() => onTransfer(t)}>
                  Transfer
                </button>
                {t.source === 'added' && (
                  <button className="icon-btn" title="Remove from this list" onClick={() => void remove(t)}>
                    <IconClose />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {tokens?.rows.some((t) => t.source === 'history') && (
        <div className="hint">
          Tokens other than {ctx.view.symbol} are listed as the history service reports them. Anyone can create a token with any name and send it to an account; the
          contract under the name tells which token it is.
        </div>
      )}
      <ViewOnlyLine ctx={ctx} />
      {tokens?.history === 'none' && (
        <div className="hint">
          {net?.name ?? 'This network'} has no history service, so only the core token and the tokens you add are listed.
        </div>
      )}
      {tokens?.history === 'error' && <div className="hint">{tokens.historyNote}</div>}
      {!adding ? (
        <button className="btn wallet-add" onClick={() => setAdding(true)}>
          Add token
        </button>
      ) : (
        <div className="wallet-form">
          <div className="hint">A token you add is listed for every account on {net?.name ?? 'this network'}.</div>
          <div className="field-row">
            <div className="field">
              <label>Contract</label>
              <input className="input mono" spellCheck={false} value={contract} placeholder="e.g. alien.worlds" onChange={(e) => setContract(e.target.value.trim().toLowerCase())} />
            </div>
            <div className="field">
              <label>Symbol</label>
              <input className="input mono" spellCheck={false} value={symbol} placeholder="e.g. TLM" onChange={(e) => setSymbol(e.target.value.trim().toUpperCase())} />
            </div>
          </div>
          <div className="buy-ram-actions">
            <button className="btn primary" disabled={busy} onClick={() => void add()}>
              {busy ? 'Checking...' : 'Add'}
            </button>
            <button className="btn" disabled={busy} onClick={() => (setAdding(false), setAddError(''))}>
              Cancel
            </button>
          </div>
          {addError && <div className="error-text">{addError}</div>}
        </div>
      )}
    </section>
  )
}
