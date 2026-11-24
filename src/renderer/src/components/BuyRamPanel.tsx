// Buy RAM in place (Deploy RAM warning, Account page Resources card): bytes
// already filled in, the cost estimated from the chain's RAM market, a payer
// that can pay. "Buy RAM" prepares eosio::buyrambytes and goes through the
// normal confirmation window (the vault is unlocked in place when needed).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RamMarket, RamPrice } from '../../../shared/ram-market'
import { formatCost, formatUnits, parseAsset, ramCost, ramForAmount, RAM_MAX_BUY } from '../../../shared/ram-market'
import { amountUnits } from '../../../shared/wallet'
import type { TxAction } from '../../../shared/api'
import { isUnlockCancelled } from '../../../shared/vault-locked'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { withVault } from '../lib/vault'
import { errorText, toast } from '../lib/toast'
import { ACCOUNT_NAME, AccountPicker, PermissionPicker, usePickList } from './AccountPicker'
import { FaucetButton, isWaxTestnet } from './FaucetButton'

/** Accounts whose balance is read to choose a payer. */
const MAX_CANDIDATES = 10

// ---------------------------------------------------------------- market

const markets = new Map<string, Promise<RamPrice>>()

/**
 * The RAM market of the current network (a market is read once per network and
 * endpoint; "not available" and errors are not kept); null while loading.
 */
export function useRamMarket(): { price: RamPrice | null; error: string } {
  const net = useStore(networkStore).current
  const key = net ? `${net.id}|${net.endpoints[net.currentEndpoint] ?? ''}` : ''
  const [price, setPrice] = useState<RamPrice | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!key) return
    let live = true
    setPrice(null)
    setError('')
    let p = markets.get(key)
    if (!p) {
      p = window.wax.chain.ramPrice(0)
      markets.set(key, p)
    }
    const mine = p
    mine.then(
      (r) => {
        // Only a market is kept: "not available" is read again on the next network,
        // endpoint or opening of the dialog.
        if (!r.available && markets.get(key) === mine) markets.delete(key)
        if (live) setPrice(r)
      },
      (e) => {
        if (markets.get(key) === mine) markets.delete(key)
        if (live) setError(errorText(e))
      }
    )
    return () => {
      live = false
    }
  }, [key])
  return { price, error }
}

/** Liquid balance text in the market's whole units (null when unreadable). */
function unitsOf(liquid: string, market: RamMarket): number | null {
  const a = parseAsset(liquid)
  if (!a) return null
  const shift = market.precision - a.precision
  return shift >= 0 ? a.units * 10 ** shift : Math.floor(a.units / 10 ** -shift)
}

// ---------------------------------------------------------------- panel

export function BuyRamPanel({
  receiver,
  initialBytes,
  onBought,
  onFaucet,
  onClose,
  byAmount,
  blockedReason,
  commandView
}: {
  /** The account that gets the RAM. */
  receiver: string
  initialBytes: number
  /** Called once the purchase is in a block. */
  onBought?: () => void
  /** Called after the faucet answered (the page refreshes its balance). */
  onFaucet?: () => void
  onClose?: () => void
  /** Offers "by amount" (eosio::buyram) next to "by bytes" (the wallet's RAM section). */
  byAmount?: boolean
  /** Set when nothing may be signed here (a view-only account): the button is disabled with this text. */
  blockedReason?: string
  /** Renders the form's Command view under it, with the action it will send. */
  commandView?: (action: TxAction | null) => React.ReactNode
}): React.JSX.Element {
  const net = useStore(networkStore).current
  const testnet = isWaxTestnet(net)
  const { price, error: marketError } = useRamMarket()
  const market = price && price.available ? price : null
  const { list } = usePickList()

  const [bytesText, setBytesText] = useState(String(initialBytes))
  const [bytesTouched, setBytesTouched] = useState(false)
  const bytes = /^\d{1,10}$/.test(bytesText) ? Number(bytesText) : NaN
  const bytesOk = Number.isInteger(bytes) && bytes >= 1 && bytes <= RAM_MAX_BUY
  const [mode, setMode] = useState<'bytes' | 'amount'>('bytes')
  const [amountText, setAmountText] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const amount = market ? amountUnits(amountText, market.precision) : null
  const amountOk = amount !== null && amount > 0
  const amountBytes = market && amountOk ? ramForAmount(market, amount) : 0
  const cost = mode === 'amount' ? (amountOk ? amount : null) : market && bytesOk ? ramCost(market, bytes) : null

  const [payer, setPayer] = useState('')
  const [payerChosen, setPayerChosen] = useState(false)
  const [permission, setPermission] = useState('active')
  const [balances, setBalances] = useState<Record<string, string | null>>({})
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<null | { text: string; kind: 'good' | 'note' | 'error' }>(null)

  // The account itself, then accounts the vault can sign for.
  const candidates = useMemo(() => {
    const signable = (list?.entries ?? []).filter((e) => e.signable.length > 0).map((e) => e.account)
    return [...new Set([receiver, ...signable])].slice(0, MAX_CANDIDATES)
  }, [list, receiver])

  const readBalance = useCallback(async (name: string): Promise<string | null> => {
    try {
      return (await window.wax.chain.account(name)).liquid
    } catch {
      return null
    }
  }, [])

  // Balances of the candidates (again after the faucet paid or a purchase).
  useEffect(() => {
    let live = true
    void Promise.all(candidates.map(async (c) => [c, await readBalance(c)] as const)).then((pairs) => {
      if (live) setBalances((b) => ({ ...b, ...Object.fromEntries(pairs) }))
    })
    return () => {
      live = false
    }
  }, [candidates, readBalance, tick])

  // A payer typed or picked outside the candidates: its balance is read too.
  useEffect(() => {
    if (!ACCOUNT_NAME.test(payer) || payer in balances) return
    let live = true
    const t = setTimeout(() => {
      void readBalance(payer).then((b) => live && setBalances((x) => ({ ...x, [payer]: b })))
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [payer, balances, readBalance])

  const covers = useCallback(
    (name: string): boolean => {
      const b = balances[name]
      if (!market || cost === null || b === undefined || b === null) return false
      const u = unitsOf(b, market)
      return u !== null && u >= cost
    },
    [balances, market, cost]
  )
  const signable = useCallback((name: string) => (list?.entries.find((e) => e.account === name)?.signable.length ?? 0) > 0, [list])
  const allRead = candidates.every((c) => c in balances)
  const nobodyCan = !!market && cost !== null && allRead && !candidates.some(covers)

  // Default payer: the account itself when it can pay, else another account the vault signs for.
  useEffect(() => {
    if (payerChosen || !market || cost === null || !allRead) return
    const pick = covers(receiver) ? receiver : (candidates.find((c) => c !== receiver && signable(c) && covers(c)) ?? receiver)
    if (pick !== payer) setPayer(pick)
  }, [payerChosen, market, cost, allRead, covers, candidates, receiver, signable, payer])

  const signerOk = ACCOUNT_NAME.test(payer) && ACCOUNT_NAME.test(permission)
  const action: TxAction | null = !signerOk
    ? null
    : mode === 'amount'
      ? market && amountOk
        ? { account: 'eosio', name: 'buyram', authorization: [{ actor: payer, permission }], data: { payer, receiver, quant: formatUnits(amount, market.precision, market.symbol) } }
        : null
      : bytesOk
        ? { account: 'eosio', name: 'buyrambytes', authorization: [{ actor: payer, permission }], data: { payer, receiver, bytes } }
        : null
  const boughtText = mode === 'amount' && market && amountOk ? `RAM for ${formatUnits(amount, market.precision, market.symbol)}` : `${bytes.toLocaleString()} bytes of RAM`

  const buy = async (): Promise<void> => {
    setBytesTouched(true)
    setAmountTouched(true)
    if (blockedReason || !action) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await withVault(() => window.wax.tx.run([action]))
      if (r.status === 'sent') {
        setMessage({ text: `${boughtText} bought for ${receiver}.`, kind: 'good' })
        toast('RAM bought', `${boughtText} for ${receiver}`, 'success')
        setTick((t) => t + 1)
        onBought?.()
      } else if (r.status === 'failed') setMessage({ text: r.error, kind: 'error' })
      // A cancel is a neutral note, never an error.
      else setMessage({ text: 'Cancelled; nothing was bought.', kind: 'note' })
    } catch (e) {
      setMessage(isUnlockCancelled(e) ? { text: 'Cancelled; nothing was bought.', kind: 'note' } : { text: errorText(e), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const payerBalance = payer ? balances[payer] : undefined
  const faucetFirst = nobodyCan && testnet
  const faucet = (
    <FaucetButton
      account={ACCOUNT_NAME.test(payer) ? payer : receiver}
      primary={faucetFirst}
      onDone={() => {
        // Read again now and once more a little later: the tokens arrive in the next blocks.
        setBalances({})
        setTick((t) => t + 1)
        setTimeout(() => setTick((t) => t + 1), 3000)
        onFaucet?.()
      }}
    />
  )

  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Buy RAM for {receiver}</div>
      {marketError && <div className="acct-note">The RAM price could not be read: {marketError}</div>}
      {price && !price.available && <div className="acct-note">{price.reason}</div>}
      {byAmount && (
        <div className="seg-pick" role="radiogroup" aria-label="Buy by">
          <label className="check-label">
            <input type="radio" checked={mode === 'bytes'} onChange={() => setMode('bytes')} /> By bytes (buyrambytes)
          </label>
          <label className="check-label">
            <input type="radio" checked={mode === 'amount'} onChange={() => setMode('amount')} /> By amount (buyram)
          </label>
        </div>
      )}
      <div className="buy-ram-fields">
        {mode === 'amount' ? (
          <div className="field buy-ram-bytes">
            <label>Amount{market ? ` (${market.symbol})` : ''}</label>
            <input
              className="input mono"
              inputMode="decimal"
              value={amountText}
              placeholder={market ? `e.g. 1.${'0'.repeat(market.precision)}` : ''}
              onChange={(e) => setAmountText(e.target.value.trim())}
              onBlur={() => setAmountTouched(true)}
            />
            {amountTouched && !amountOk && market && (
              <div className="acct-note bad">Enter an amount above zero with at most {market.precision} decimals.</div>
            )}
          </div>
        ) : (
        <div className="field buy-ram-bytes">
          <label>Bytes</label>
          <input
            className="input mono"
            inputMode="numeric"
            value={bytesText}
            onChange={(e) => setBytesText(e.target.value.replace(/[\s,.]/g, ''))}
            onBlur={() => setBytesTouched(true)}
          />
          {bytesTouched && !bytesOk && <div className="acct-note bad">Enter a whole number of bytes from 1 to {RAM_MAX_BUY.toLocaleString()}.</div>}
        </div>
        )}
        <div className="field buy-ram-payer">
          <label>Paid by</label>
          <div className="signer-row">
            <div className="grow">
              <AccountPicker
                mode="signer"
                value={payer}
                onChange={(a) => {
                  setPayer(a)
                  setPayerChosen(true)
                }}
              />
            </div>
            <div className="perm">
              <PermissionPicker account={payer} value={permission} onChange={setPermission} />
            </div>
          </div>
        </div>
      </div>
      <div className="buy-ram-lines">
        {mode === 'amount' ? (
          <span>
            You get: {!market ? (price ? 'not available' : 'reading the RAM market...') : amountOk ? `about ${amountBytes.toLocaleString()} bytes (after the 0.5% fee)` : '-'}
          </span>
        ) : (
        <span>
          Cost:{' '}
          {!market
            ? price
              ? 'not available'
              : 'reading the RAM market...'
            : cost === null
              ? bytesOk
                ? 'more than the market holds'
                : '-'
              : `about ${formatCost(cost, market.precision, market.symbol)}`}
        </span>
        )}
        {payer && (
          <span>
            Balance of {payer}:{' '}
            {payerBalance === undefined ? 'reading...' : payerBalance === null ? 'could not be read' : market ? formatUnits(unitsOf(payerBalance, market) ?? 0, market.precision, market.symbol) : payerBalance}
          </span>
        )}
      </div>
      {nobodyCan && (
        <div className="acct-note">
          {testnet
            ? `None of your accounts has enough ${market?.symbol ?? ''} to pay. Request testnet tokens first, then press Buy RAM.`
            : `None of your accounts has enough ${market?.symbol ?? ''} to pay; send some to the payer first.`}
        </div>
      )}
      <div className="buy-ram-actions">
        {faucetFirst && faucet}
        <button className={`btn${faucetFirst ? '' : ' primary'}`} disabled={busy || !market || !ACCOUNT_NAME.test(payer) || !!blockedReason} onClick={() => void buy()}>
          {busy ? 'Waiting for confirmation...' : 'Buy RAM'}
        </button>
        {!faucetFirst && faucet}
        {onClose && (
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {blockedReason && <div className="acct-note">{blockedReason}</div>}
      {commandView?.(action)}
      {message && <div className={message.kind === 'error' ? 'error-text' : message.kind === 'note' ? 'hint' : 'acct-note good'}>{message.text}</div>}
    </div>
  )
}
