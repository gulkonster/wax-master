// Transfer: sends a token from an account the vault can sign for to another
// account. The recipient is checked on the chain first; the sender's balance and
// the token's precision are read from the chain for every token and sender; the
// action goes through the confirmation window.

import { useEffect, useMemo, useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import type { TokenRow, WalletTokens } from '../../../../shared/chain-types'
import { MEMO_MAX_BYTES, amountUnits, assetUnits, formatUnits, memoBytes } from '../../../../shared/wallet'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { AccountPicker, PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, NAME, recipientProblem, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'
import { amountNote, CLEARED_FIELD, type AmountField } from './wallet-form'
import { Busy } from '../../components/Busy'

type ChainBalance = { status: 'reading' } | { status: 'ok'; balance: string; precision: number } | { status: 'error'; text: string } | { status: 'none' }

export function TransferSection({ ctx, tokens, initial }: { ctx: WalletContext; tokens: WalletTokens | null; initial: TokenRow | null }): React.JSX.Element {
  const net = useStore(networkStore).current
  const { view } = ctx
  const rows = useMemo<TokenRow[]>(
    () => tokens?.rows ?? [{ contract: 'eosio.token', symbol: view.symbol, precision: net?.precision ?? 8, balance: view.liquid, source: 'core', mark: { kind: 'core', text: 'core token' } }],
    [tokens, view, net]
  )
  const [tokenId, setTokenId] = useState(initial ? `${initial.contract}|${initial.symbol}` : `eosio.token|${view.symbol}`)
  const token = rows.find((r) => `${r.contract}|${r.symbol}` === tokenId) ?? rows[0]

  const [from, setFrom] = useState(view.name)
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState<AmountField>(CLEARED_FIELD)
  const [memo, setMemo] = useState('')
  const [touched, setTouched] = useState(false)
  const [toProblem, setToProblem] = useState<string | null>(null)
  const [chainBalance, setChainBalance] = useState<ChainBalance>({ status: 'none' })
  const { busy, message, send } = useSend(ctx.afterSend)

  useEffect(() => {
    if (initial) setTokenId(`${initial.contract}|${initial.symbol}`)
  }, [initial])

  // The sender's balance and the token's precision, read from the chain (again after every send).
  const contract = token?.contract ?? ''
  const symbol = token?.symbol ?? ''
  useEffect(() => {
    if (!contract || !NAME.test(from)) {
      setChainBalance({ status: 'none' })
      return
    }
    setChainBalance({ status: 'reading' })
    let live = true
    const t = setTimeout(() => {
      window.wax.wallet.balance(from, contract, symbol).then(
        (b) => live && setChainBalance({ status: 'ok', balance: b.balance, precision: b.precision }),
        (e) => live && setChainBalance({ status: 'error', text: errorText(e) })
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [from, contract, symbol, ctx.readTick])

  const read = chainBalance.status === 'ok' ? chainBalance : null
  const precision = read?.precision ?? token?.precision ?? 0
  const units = token ? amountUnits(amount.text, precision) : null
  const quantity = token && read && units !== null && units > 0n ? formatUnits(units, precision, token.symbol) : null
  const have = token && read ? assetUnits(read.balance, precision, token.symbol) : null
  const tooMuch = units !== null && have !== null && units > have
  const memoOk = memoBytes(memo) <= MEMO_MAX_BYTES
  const sameAccount = NAME.test(to) && to === from
  const note = amountNote(amount, precision, true)

  const action: TxAction | null =
    token && quantity && NAME.test(from) && NAME.test(permission) && NAME.test(to) && memoOk && !sameAccount
      ? { account: token.contract, name: 'transfer', authorization: [{ actor: from, permission }], data: { from, to, quantity, memo } }
      : null

  const submit = async (): Promise<void> => {
    setTouched(true)
    setAmount((a) => ({ ...a, touched: true }))
    if (ctx.viewOnly || !action || !token) return
    const problem = await recipientProblem(to, net?.name ?? 'this network')
    setToProblem(problem)
    if (problem) return
    await send([action], `${quantity} sent to ${to}.`, () => {
      // A sent form is empty and untouched: nothing is red after a success.
      setAmount(CLEARED_FIELD)
      setTo('')
      setMemo('')
      setTouched(false)
      setToProblem(null)
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
                {r.symbol} ({r.contract}){r.mark?.kind === 'lookalike' ? `: ${r.mark.text}` : ''}
              </option>
            ))}
          </select>
          {token && token.mark?.kind !== 'core' && (
            <div className={`acct-note${token.mark?.kind === 'lookalike' ? ' warn' : ''}`}>
              {token.mark?.kind === 'lookalike' && <>This token is {token.mark.text}. </>}
              This calls <code>{token.contract}::transfer</code>.
            </div>
          )}
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
          {token && (
            <div className="acct-note">
              Balance:{' '}
              {chainBalance.status === 'ok'
                ? chainBalance.balance
                : chainBalance.status === 'reading'
                  ? 'reading...'
                  : chainBalance.status === 'error'
                    ? `could not be read: ${chainBalance.text}`
                    : '-'}
            </div>
          )}
        </div>
        <div className="field">
          <label>To</label>
          <AccountPicker mode="other" value={to} onChange={(v) => (setTo(v), setToProblem(null))} placeholder="recipient account" />
          {toProblem && <div className="acct-note bad">{toProblem}</div>}
          {touched && sameAccount && <div className="acct-note bad">The recipient is the sender.</div>}
        </div>
        <div className="field">
          <label>Amount{token ? ` (${token.symbol}, ${precision} decimals)` : ''}</label>
          <input
            className="input mono"
            inputMode="decimal"
            value={amount.text}
            onChange={(e) => setAmount((a) => ({ ...a, text: e.target.value.trim() }))}
            onBlur={() => setAmount((a) => ({ ...a, touched: true }))}
          />
          {note && <div className="acct-note bad">{note}</div>}
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
            {busy ? <Busy text="Waiting for confirmation..." /> : 'Transfer'}
          </button>
        </div>
        <ViewOnlyLine ctx={ctx} />
        <SendLine message={message} />
        <CommandView action={action} />
      </div>
    </section>
  )
}
