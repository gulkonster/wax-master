// Transfer: sends a token from an account the vault can sign for to another
// account. The recipient is checked on the chain first; the amount uses the
// token's precision; the action goes through the confirmation window.

import { useEffect, useMemo, useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import type { TokenRow, WalletTokens } from '../../../../shared/chain-types'
import { MEMO_MAX_BYTES, amountUnits, assetUnits, memoBytes, quantityText } from '../../../../shared/wallet'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { AccountPicker, PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, NAME, recipientProblem, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'

export function TransferSection({ ctx, tokens, initial }: { ctx: WalletContext; tokens: WalletTokens | null; initial: TokenRow | null }): React.JSX.Element {
  const net = useStore(networkStore).current
  const { view } = ctx
  const rows = useMemo<TokenRow[]>(
    () => tokens?.rows ?? [{ contract: 'eosio.token', symbol: view.symbol, precision: net?.precision ?? 8, balance: view.liquid, source: 'core' }],
    [tokens, view, net]
  )
  const [tokenId, setTokenId] = useState(initial ? `${initial.contract}|${initial.symbol}` : `eosio.token|${view.symbol}`)
  const token = rows.find((r) => `${r.contract}|${r.symbol}` === tokenId) ?? rows[0]

  const [from, setFrom] = useState(view.name)
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [touched, setTouched] = useState(false)
  const [toProblem, setToProblem] = useState<string | null>(null)
  const [fromBalance, setFromBalance] = useState<string | null>(null)
  const { busy, message, send } = useSend()

  useEffect(() => {
    if (initial) setTokenId(`${initial.contract}|${initial.symbol}`)
  }, [initial])

  // Balance of the sender in the chosen token (the account's own row when it is the sender).
  useEffect(() => {
    setFromBalance(null)
    if (!token || !NAME.test(from)) return
    if (from === view.name) {
      setFromBalance(token.balance || null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      window.wax.wallet.tokens(from).then(
        (w) => live && setFromBalance(w.rows.find((r) => r.contract === token.contract && r.symbol === token.symbol)?.balance ?? `0 ${token.symbol}`),
        () => live && setFromBalance(null)
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [from, token, view.name])

  const units = token ? amountUnits(amount, token.precision) : null
  const quantity = token && units !== null && units > 0 ? quantityText(amount, token.precision, token.symbol) : null
  const have = token && fromBalance ? assetUnits(fromBalance, token.precision, token.symbol) : null
  const tooMuch = units !== null && have !== null && units > have
  const memoOk = memoBytes(memo) <= MEMO_MAX_BYTES
  const sameAccount = NAME.test(to) && to === from

  const action: TxAction | null =
    token && quantity && NAME.test(from) && NAME.test(permission) && NAME.test(to) && memoOk && !sameAccount
      ? { account: token.contract, name: 'transfer', authorization: [{ actor: from, permission }], data: { from, to, quantity, memo } }
      : null

  const submit = async (): Promise<void> => {
    setTouched(true)
    if (ctx.viewOnly || !action || !token) return
    const problem = await recipientProblem(to, net?.name ?? 'this network')
    setToProblem(problem)
    if (problem) return
    await send([action], `${quantity} sent to ${to}.`, () => {
      setAmount('')
      ctx.reload()
    })
  }

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Transfer</h3>
        <HelpButton place="walletTransfers" />
      </div>
      <p className="wallet-lead">Sends tokens from an account the vault can sign for to another account. The confirmation window shows the transaction before anything is signed.</p>
      <div className="wallet-form">
        <div className="field">
          <label>Token</label>
          <select className="select" value={tokenId} onChange={(e) => setTokenId(e.target.value)}>
            {rows.map((r) => (
              <option key={`${r.contract}|${r.symbol}`} value={`${r.contract}|${r.symbol}`}>
                {r.symbol} ({r.contract})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <div className="signer-row">
            <div className="grow">
              <AccountPicker mode="signer" value={from} onChange={setFrom} />
            </div>
            <div className="perm">
              <PermissionPicker account={from} value={permission} onChange={setPermission} />
            </div>
          </div>
          {token && <div className="acct-note">Balance: {fromBalance ?? (NAME.test(from) ? 'reading...' : '-')}</div>}
        </div>
        <div className="field">
          <label>To</label>
          <AccountPicker mode="other" value={to} onChange={(v) => (setTo(v), setToProblem(null))} placeholder="recipient account" />
          {toProblem && <div className="acct-note bad">{toProblem}</div>}
          {touched && sameAccount && <div className="acct-note bad">The recipient is the sender.</div>}
        </div>
        <div className="field">
          <label>Amount{token ? ` (${token.symbol}, ${token.precision} decimals)` : ''}</label>
          <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} onBlur={() => setTouched(true)} />
          {touched && token && (units === null || units <= 0) && (
            <div className="acct-note bad">Enter an amount above zero with at most {token.precision} decimals.</div>
          )}
          {quantity && <div className="acct-note">Sends {quantity}.</div>}
          {tooMuch && <div className="acct-note bad">More than the balance of {from}.</div>}
        </div>
        <div className="field">
          <label>Memo</label>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
          {!memoOk && <div className="acct-note bad">At most {MEMO_MAX_BYTES} bytes.</div>}
        </div>
        <div className="buy-ram-actions">
          <button className="btn primary" disabled={busy || ctx.viewOnly || !action || tooMuch} onClick={() => void submit()}>
            {busy ? 'Waiting for confirmation...' : 'Transfer'}
          </button>
        </div>
        <ViewOnlyLine ctx={ctx} />
        <SendLine message={message} />
        <CommandView action={action} />
      </div>
    </section>
  )
}
