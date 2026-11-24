// Name bids: bid on a premium name (1 to 11 characters), see where its auction
// stands, claim an outbid amount back, and create a won name. One name at a
// time: the name, then what the chain says about it, then the bid. Everything
// is read on request; nothing is polled.

import { useCallback, useEffect, useState } from 'react'
import type { NameAuctions, NameBidLookup } from '../../../../shared/chain-types'
import {
  BID_WARNING,
  bidAmountProblem,
  bidNameProblem,
  bidnameAction,
  bidrefundAction,
  closingRuleText,
  higherOpenCount,
  NAME_AUCTIONS_SHOWN,
  nameBidState,
  type NameBidState
} from '../../../../shared/name-bids'
import { amountUnits, assetUnits, formatUnits } from '../../../../shared/wallet'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, fmtTime, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'
import { amountNote, CLEARED_FIELD, type AmountField } from './wallet-form'

/** Why Bid is off in a state that allows no bid ('' when a bid is possible). */
function noBidReason(s: NameBidState, name: string, account: string): string {
  switch (s.kind) {
    case 'exists':
      return `The account ${name} exists: a name that is taken cannot be bid on.`
    case 'own':
      return `${account} has the highest bid. The chain refuses a second bid from the highest bidder, so Bid is off until another account outbids it.`
    case 'closed':
      return `The auction is closed: ${s.bid.highBidder} won ${name}, and only ${s.bid.highBidder} can create it.`
    case 'won':
      return `${account} won ${name}: create it in Create account.`
    default:
      return ''
  }
}

export function NameBidsSection({ ctx, onCreate }: { ctx: WalletContext; onCreate: (name: string) => void }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [lookup, setLookup] = useState<NameBidLookup | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [reading, setReading] = useState(false)
  const [auctions, setAuctions] = useState<NameAuctions | null>(null)
  const [auctionsError, setAuctionsError] = useState('')
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [amount, setAmount] = useState<AmountField>(CLEARED_FIELD)
  const [problem, setProblem] = useState<string | null>(null)
  const bid = useSend(ctx.afterSend)
  const refund = useSend(ctx.afterSend)

  const readAuctions = useCallback(async (): Promise<void> => {
    setAuctionsError('')
    try {
      setAuctions(await window.wax.wallet.nameAuctions())
    } catch (e) {
      setAuctionsError(errorText(e))
    }
  }, [])

  /** Reads the name for this account; null when the name breaks the rule or the read failed. */
  const readName = useCallback(
    async (n: string): Promise<NameBidLookup | null> => {
      setNameTouched(true)
      if (bidNameProblem(n)) return null
      setReading(true)
      setLookupError('')
      try {
        const l = await window.wax.wallet.nameBid(n, view.name)
        setLookup(l)
        return l
      } catch (e) {
        setLookup(null)
        setLookupError(errorText(e))
        return null
      } finally {
        setReading(false)
      }
    },
    [view.name]
  )

  // The auctions on opening and after each read of the account (a sent bid too); the name read again with them.
  useEffect(() => {
    void readAuctions()
  }, [readAuctions, ctx.readTick])
  const readNameName = lookup?.name ?? ''
  useEffect(() => {
    if (ctx.readTick > 0 && readNameName) void readName(readNameName)
    // Only a new read of the account starts this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.readTick])

  const readAgain = (): void => {
    void readAuctions()
    if (name) void readName(name)
  }

  const nameProblem = nameTouched ? bidNameProblem(name) : ''
  // A read belongs to the name in the field and to this account; a changed name waits for its own read.
  const current = lookup && lookup.name === name && lookup.account === view.name ? lookup : null
  const state = current ? nameBidState(current) : null
  const precision = current?.precision ?? auctions?.precision ?? net?.precision ?? 8
  const symbol = current?.symbol ?? auctions?.symbol ?? view.symbol
  const fmt = (u: bigint | string): string => formatUnits(BigInt(u), precision, symbol)

  const canBid = !!state && (state.kind === 'none' || state.kind === 'open')
  const minBid = state && (state.kind === 'none' || state.kind === 'open' || state.kind === 'own') ? state.minBid : 1n
  const units = amount.text.trim() === '' ? null : amountUnits(amount.text, precision)
  const available = assetUnits(view.liquid, precision, symbol)
  const fieldNote = amountNote(amount, precision, true)
  const amountProblem = !fieldNote && amount.touched && units !== null ? bidAmountProblem(units, minBid, available, view.name, precision, symbol) : ''
  const action =
    canBid && current && units !== null && !bidAmountProblem(units, minBid, available, view.name, precision, symbol)
      ? bidnameAction({ bidder: view.name, permission, newname: current.name, units, precision, symbol })
      : null
  const higher = current && auctions && state && (state.kind === 'open' || state.kind === 'own') ? higherOpenCount(auctions, BigInt(state.bid.highBid), current.name) : null

  const submit = async (): Promise<void> => {
    setAmount((f) => ({ ...f, touched: true }))
    setProblem(null)
    if (ctx.viewOnly || !action || !current || units === null) return
    // The auction is read again just before the confirmation: another bid may have come in.
    const fresh = await readName(current.name)
    if (!fresh) return
    const s = nameBidState(fresh)
    if (s.kind !== 'none' && s.kind !== 'open') {
      setProblem(noBidReason(s, fresh.name, view.name))
      return
    }
    if (units < s.minBid) {
      setProblem(`The highest bid changed since it was read: the smallest bid is now ${fmt(s.minBid)}.`)
      return
    }
    await bid.send(
      [bidnameAction({ bidder: view.name, permission, newname: fresh.name, units, precision: fresh.precision, symbol: fresh.symbol })],
      `Bid of ${formatUnits(units, fresh.precision, fresh.symbol)} on ${fresh.name} sent.`,
      () => setAmount(CLEARED_FIELD)
    )
  }

  const claim = async (): Promise<void> => {
    if (ctx.viewOnly || !current?.refund) return
    await refund.send([bidrefundAction({ bidder: view.name, permission, newname: current.name })], `Refund of ${fmt(current.refund)} on ${current.name} claimed.`)
  }

  const pick = (n: string): void => {
    setName(n)
    setAmount(CLEARED_FIELD)
    setProblem(null)
    void readName(n)
  }

  const lastClose = auctions?.lastNameClose ? fmtTime(auctions.lastNameClose) : ''
  const shown = auctions ? auctions.open.slice(0, NAME_AUCTIONS_SHOWN) : []
  const reason = state ? noBidReason(state, current?.name ?? name, view.name) : ''
  // The bid form for a name that can be bid on, and (disabled, with the reason) for the highest bidder.
  const showBidForm = !!state && (state.kind === 'none' || state.kind === 'open' || state.kind === 'own')

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Name bids</h3>
        <HelpButton place="walletNameBids" />
      </div>
      <p className="wallet-lead">
        Names of 1 to 11 characters are premium: they go to the highest bidder of an auction. Bid on a name, see where its auction stands, and claim your bid back when
        another account outbids you.
      </p>

      <div className="buy-ram">
        <div className="buy-ram-title">Name</div>
        <div className="field">
          <label>Name</label>
          <input
            className="input mono"
            value={name}
            maxLength={13}
            placeholder="1 to 11 characters"
            onChange={(e) => {
              setName(e.target.value.trim().toLowerCase())
              setNameTouched(false)
              setProblem(null)
            }}
            onBlur={() => name && void readName(name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void readName(name)
            }}
          />
          {nameProblem && <div className="acct-note bad">{nameProblem}</div>}
          {!nameProblem && !nameTouched && <div className="hint">a-z and 1-5, no dot. Press Enter or leave the field to read it.</div>}
        </div>
        <div className="buy-ram-actions">
          <button className="btn" disabled={reading} onClick={readAgain}>
            {reading ? 'Reading...' : 'Read again'}
          </button>
        </div>
        {lookupError && <div className="error-text">The name could not be read: {lookupError}</div>}

        {current && state && (
          <div className="card-list">
            {state.kind === 'none' && <div className="hint">No bid on {current.name} yet: any amount above zero opens the auction.</div>}
            {(state.kind === 'open' || state.kind === 'own' || state.kind === 'closed' || state.kind === 'won') && (
              <>
                <div className="kv-row">
                  <span>{state.kind === 'closed' || state.kind === 'won' ? 'Winning bid' : 'Highest bid'}</span>
                  <span className="num">{fmt(state.bid.highBid)}</span>
                </div>
                <div className="kv-row">
                  <span>{state.kind === 'closed' || state.kind === 'won' ? 'Won by' : 'Highest bidder'}</span>
                  <span className="num mono">{state.bid.highBidder}</span>
                </div>
                <div className="kv-row">
                  <span>Last bid</span>
                  <span className="num">{fmtTime(state.bid.lastBidTime)}</span>
                </div>
              </>
            )}
            {(state.kind === 'open' || state.kind === 'own') && (
              <div className="kv-row">
                <span>Smallest next bid</span>
                <span className="num">{fmt(state.minBid)}</span>
              </div>
            )}
            {higher && (
              <div className="hint">
                {higher.count === 0
                  ? 'No open auction has a higher bid.'
                  : `${higher.atLeast ? 'At least ' : ''}${higher.count} open auction${higher.count === 1 ? ' has' : 's have'} a higher bid.`}
              </div>
            )}
            {reason && <div className="acct-note">{reason}</div>}
            {state.kind === 'won' && (
              <div>
                <button className="btn" onClick={() => onCreate(current.name)}>
                  Create account {current.name}
                </button>
              </div>
            )}
          </div>
        )}

        {current?.refund && (
          <div className="card-list">
            <div className="kv-row">
              <span>Your outbid amount on {current.name}</span>
              <span className="num">
                {fmt(current.refund)}{' '}
                <button
                  className="btn subtle sm"
                  disabled={refund.busy || ctx.viewOnly}
                  title={ctx.viewOnly ? ctx.reason : 'Sends eosio::bidrefund'}
                  onClick={() => void claim()}
                >
                  {refund.busy ? 'Waiting for confirmation...' : 'Claim refund'}
                </button>
              </span>
            </div>
            <div className="buy-ram-actions">
              <div className="perm-inline">
                <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
              </div>
            </div>
            <ViewOnlyLine ctx={ctx} />
          </div>
        )}
        {/* Outside the refund card: the card goes when the claim is read back, the result line stays. */}
        <SendLine message={refund.message} />
      </div>

      {showBidForm && (
        <div className="buy-ram">
          <div className="buy-ram-title">Bid</div>
          <div className="field">
            <label>Bidder</label>
            <div className="signer-row">
              <div className="grow mono">{view.name}</div>
              <div className="perm">
                <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
              </div>
            </div>
            <div className="acct-note">Available: {view.liquid}</div>
          </div>
          <div className="field">
            <label>Bid ({symbol})</label>
            <input
              className="input mono"
              inputMode="decimal"
              value={amount.text}
              placeholder={formatUnits(minBid, precision, symbol).split(' ')[0]}
              disabled={!canBid}
              onChange={(e) => {
                const text = e.target.value.trim()
                setAmount((f) => ({ ...f, text }))
                setProblem(null)
              }}
              onBlur={() => setAmount((f) => ({ ...f, touched: true }))}
            />
            {fieldNote && <div className="acct-note bad">{fieldNote}</div>}
            {amountProblem && <div className="acct-note bad">{amountProblem}</div>}
          </div>
          <div className="hint">{BID_WARNING}</div>
          <div className="hint">{closingRuleText(lastClose)}</div>
          {problem && <div className="acct-note bad">{problem}</div>}
          <div className="buy-ram-actions">
            <button
              className="btn primary"
              disabled={bid.busy || ctx.viewOnly || !canBid || !action}
              title={ctx.viewOnly ? ctx.reason : !canBid ? reason : undefined}
              onClick={() => void submit()}
            >
              {bid.busy ? 'Waiting for confirmation...' : 'Bid'}
            </button>
          </div>
          <ViewOnlyLine ctx={ctx} />
          <SendLine message={bid.message} />
          <CommandView action={action} />
        </div>
      )}

      <div className="buy-ram">
        <div className="buy-ram-title">Highest open bids</div>
        {auctionsError && <div className="error-text">The open auctions could not be read: {auctionsError}</div>}
        {!auctions && !auctionsError && <div className="hint">Reading...</div>}
        {auctions && shown.length === 0 && <div className="hint">No open auction on {net?.name ?? 'this network'}: a new bid here would be the highest.</div>}
        {shown.length > 0 && (
          <table className="tx-table clickable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Highest bid</th>
                <th>Last bid</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr
                  key={b.name}
                  tabIndex={0}
                  title={`Read ${b.name}`}
                  onClick={() => pick(b.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') pick(b.name)
                  }}
                >
                  <td className="mono">{b.name}</td>
                  <td className="nowrap">{fmt(b.highBid)}</td>
                  <td className="time">{fmtTime(b.lastBidTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {auctions && !showBidForm && <div className="hint">{closingRuleText(lastClose)}</div>}
      </div>
    </section>
  )
}
