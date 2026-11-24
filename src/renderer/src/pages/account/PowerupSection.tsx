// PowerUp: rent CPU and NET for the chain's PowerUp period (one day on WAX) for
// this account or another one. The cost is computed from the powup.state row
// before the confirmation; max_payment is the cost plus a small margin.

import { useEffect, useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import type { PowerupStateView } from '../../../../shared/chain-types'
import { POWERUP_MARGIN_PERCENT, powerupAction, powerupQuote, requoteDecision } from '../../../../shared/powerup'
import { amountUnits, assetUnits, formatUnits } from '../../../../shared/wallet'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { AccountPicker, PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, fmtUs, NAME, recipientProblem, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'
import { amountNote, CLEARED_FIELD, type AmountField } from './wallet-form'

function units(f: AmountField, precision: number): bigint | null {
  return f.text.trim() === '' ? 0n : amountUnits(f.text, precision)
}

function usedPercent(r: PowerupStateView['cpu']): string {
  const w = Number(r.weight)
  return w > 0 ? `${((Number(r.utilization) / w) * 100).toFixed(2)} % rented` : '-'
}

export function PowerupSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const [state, setState] = useState<PowerupStateView | null>(null)
  const [readAt, setReadAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [receiver, setReceiver] = useState(view.name)
  const [cpu, setCpu] = useState<AmountField>(CLEARED_FIELD)
  const [netAmt, setNetAmt] = useState<AmountField>(CLEARED_FIELD)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, message, send } = useSend(ctx.afterSend)

  const read = async (): Promise<PowerupStateView | null> => {
    setError('')
    try {
      const s = await window.wax.wallet.powerup()
      setState(s)
      setReadAt(Date.now())
      setNow(Date.now())
      if (!s) setError('The PowerUp state of this chain could not be read in the expected form.')
      return s
    } catch (e) {
      setError(errorText(e))
      return null
    }
  }

  useEffect(() => {
    void read()
    // Read again with the account (after a sent transaction too).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ctx.readTick])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const precision = state?.precision ?? net?.precision ?? 8
  const symbol = state?.symbol ?? view.symbol
  const cpuU = units(cpu, precision)
  const netU = units(netAmt, precision)
  // Chain time: the head time of the read plus the time since.
  const chainNow = (s: PowerupStateView, at: number, t: number): number => s.headTime + Math.max(0, Math.floor((t - at) / 1000))
  const quote = state && cpuU !== null && netU !== null ? powerupQuote(state, cpuU, netU, chainNow(state, readAt, now)) : null
  const touched = cpu.touched || netAmt.touched
  const fieldNote = amountNote(cpu, precision, false) || amountNote(netAmt, precision, false)
  const available = assetUnits(view.liquid, precision, symbol)
  const tooMuch = quote !== null && !quote.problem && available !== null && quote.maxPayment > available
  const build = (s: PowerupStateView, q: NonNullable<typeof quote>): TxAction | null =>
    !q.problem && NAME.test(receiver) && NAME.test(permission)
      ? powerupAction({ payer: view.name, receiver, permission, days: s.days, quote: q, maxPaymentText: formatUnits(q.maxPayment, s.precision, s.symbol) })
      : null
  const action = state && quote ? build(state, quote) : null

  // CPU time is shown as an estimate only from the account's own stake: time per staked unit today.
  const cpuStaked = assetUnits(view.cpuWeight, precision, symbol)
  const cpuHint =
    cpuU !== null && cpuU > 0n && cpuStaked !== null && cpuStaked > 0n && view.cpu.max > 0
      ? `About ${fmtUs(Math.floor((Number(cpuU) / Number(cpuStaked)) * view.cpu.max))} of CPU, judged by what ${view.name}'s own stake gives today; it changes with the chain's load.`
      : ''

  const submit = async (): Promise<void> => {
    setCpu((f) => ({ ...f, touched: true }))
    setNetAmt((f) => ({ ...f, touched: true }))
    if (ctx.viewOnly || !action || !quote || cpuU === null || netU === null) return
    // The most it may take, as the page shows it at this click: nothing above it is signed.
    const shownMax = quote.maxPayment
    const p = receiver === view.name ? null : await recipientProblem(receiver, net?.name ?? 'this network')
    setProblem(p)
    if (p) return
    // The cost is computed again from a fresh read of the market just before the confirmation.
    const fresh = await read()
    if (!fresh) return
    const q = powerupQuote(fresh, cpuU, netU, fresh.headTime)
    const decision = requoteDecision(shownMax, q)
    if (decision === 'feeRose') {
      setProblem(
        `The cost rose to ${formatUnits(q.fee, fresh.precision, fresh.symbol)} since it was shown (most it may take now ${formatUnits(q.maxPayment, fresh.precision, fresh.symbol)}). Press PowerUp again to accept it.`
      )
      return
    }
    const a = decision === 'send' ? build(fresh, q) : null
    if (!a) {
      setProblem(q.problem || 'The PowerUp could not be built.')
      return
    }
    const freshAvailable = assetUnits(view.liquid, fresh.precision, fresh.symbol)
    if (freshAvailable !== null && q.maxPayment > freshAvailable) {
      setProblem(`More than the available balance of ${view.name}.`)
      return
    }
    await send([a], `PowerUp sent for ${receiver}.`, () => {
      setCpu(CLEARED_FIELD)
      setNetAmt(CLEARED_FIELD)
      setProblem(null)
    })
  }

  const days = state?.days ?? 1
  const refusedFee = message?.kind === 'error' && /max_payment is less than/i.test(message.text)

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>PowerUp</h3>
        <HelpButton place="walletPowerup" />
      </div>
      <p className="wallet-lead">
        PowerUp rents CPU and NET for {days === 1 ? 'one day' : `${days} days`} for a fee, without staking. The fee is spent: unlike a stake, it does not come back.
      </p>
      {error && <div className="error-text">{error}</div>}
      {!state && !error && <div className="hint">Reading...</div>}
      {state && (
        <>
          <div className="card-list">
            <div className="kv-row">
              <span>CPU market</span>
              <span className="num">{usedPercent(state.cpu)}</span>
            </div>
            <div className="kv-row">
              <span>NET market</span>
              <span className="num">{usedPercent(state.net)}</span>
            </div>
            <div className="kv-row">
              <span>Smallest fee</span>
              <span className="num">{formatUnits(BigInt(state.minFee), state.precision, state.symbol)}</span>
            </div>
          </div>
          <div className="buy-ram">
            <div className="buy-ram-title">Rent CPU and NET</div>
            <div className="hint">
              Enter the size as an amount of staked {symbol}: the account gets the share of CPU or NET that this much stake would give, for {days === 1 ? 'one day' : `${days} days`}.
            </div>
            <div className="field">
              <label>Payer</label>
              <div className="signer-row">
                <div className="grow mono">{view.name}</div>
                <div className="perm">
                  <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
                </div>
              </div>
              <div className="acct-note">Available: {view.liquid}</div>
            </div>
            <div className="field">
              <label>Receiver (gets the CPU and NET)</label>
              <AccountPicker mode="other" value={receiver} onChange={(v) => (setReceiver(v), setProblem(null))} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>CPU (as staked {symbol})</label>
                <input
                  className="input mono"
                  inputMode="decimal"
                  value={cpu.text}
                  placeholder="0"
                  onChange={(e) => {
                    const text = e.target.value.trim()
                    setCpu((f) => ({ ...f, text }))
                    setProblem(null)
                  }}
                  onBlur={() => setCpu((f) => ({ ...f, touched: true }))}
                />
              </div>
              <div className="field">
                <label>NET (as staked {symbol})</label>
                <input
                  className="input mono"
                  inputMode="decimal"
                  value={netAmt.text}
                  placeholder="0"
                  onChange={(e) => {
                    const text = e.target.value.trim()
                    setNetAmt((f) => ({ ...f, text }))
                    setProblem(null)
                  }}
                  onBlur={() => setNetAmt((f) => ({ ...f, touched: true }))}
                />
              </div>
            </div>
            {cpuHint && <div className="hint">{cpuHint}</div>}
            {fieldNote && <div className="acct-note bad">{fieldNote}</div>}
            {!fieldNote && touched && quote?.problem && <div className="acct-note bad">{quote.problem}</div>}
            <div className="buy-ram-lines">
              <span>
                Cost: {quote && !quote.problem ? `about ${formatUnits(quote.fee, precision, symbol)}` : '-'}
              </span>
              <span>
                Most it may take (max_payment):{' '}
                {quote && !quote.problem ? `${formatUnits(quote.maxPayment, precision, symbol)} (the cost plus ${POWERUP_MARGIN_PERCENT.toString()} %)` : '-'}
              </span>
            </div>
            {tooMuch && <div className="acct-note bad">More than the available balance of {view.name}.</div>}
            {problem && <div className="acct-note bad">{problem}</div>}
            <div className="buy-ram-actions">
              <button className="btn primary" disabled={busy || ctx.viewOnly || !action || tooMuch} onClick={() => void submit()}>
                {busy ? 'Waiting for confirmation...' : 'PowerUp'}
              </button>
            </div>
            <ViewOnlyLine ctx={ctx} />
            <SendLine message={message} />
            {refusedFee && <div className="hint">The market price rose above the most it may take since the cost was computed. Nothing was paid; press PowerUp again to compute it anew.</div>}
            <CommandView action={action} />
          </div>
        </>
      )}
    </section>
  )
}
