// RAM: what the account holds, the price from the chain's RAM market, buying
// (by bytes or by amount, for this account) and selling unused RAM.

import { useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import { accountRamDefault, formatCost, formatUnits, ramCost, ramSellReturn } from '../../../../shared/ram-market'
import { BuyRamPanel, useRamMarket } from '../../components/BuyRamPanel'
import { PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, fmtBytes, FormSwitch, Gauge, NAME, pct, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'

export function RamSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const { price, error } = useRamMarket()
  const market = price && price.available ? price : null
  const unlimited = view.ram.quota < 0
  const free = unlimited ? 0 : Math.max(0, view.ram.quota - view.ram.usage)
  const perKb = market ? ramCost(market, 1024) : null
  const [form, setForm] = useState<'buy' | 'sell'>('buy')

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>RAM</h3>
        <HelpButton place="walletRam" />
      </div>
      <p className="wallet-lead">RAM is the storage an account pays for to keep data on the chain (its contract, its tables, its token rows). It is bought and sold at the chain's RAM market price.</p>
      <div className="card-list">
        <Gauge label="RAM" text={`${fmtBytes(view.ram.usage)} used of ${fmtBytes(view.ram.quota)}`} value={pct(view.ram.usage, view.ram.quota)} />
        <div className="kv-row">
          <span>Price</span>
          <span className="num">
            {market && perKb !== null ? `about ${formatCost(perKb, market.precision, market.symbol)} per KB` : error ? `could not be read: ${error}` : price ? 'not available' : 'reading...'}
          </span>
        </div>
      </div>
      {price && !price.available ? (
        <div className="hint">{price.reason}</div>
      ) : (
        <>
          {!unlimited && (
            <FormSwitch
              label="RAM form"
              value={form}
              options={[
                { id: 'buy', label: 'Buy' },
                { id: 'sell', label: 'Sell' }
              ]}
              onChange={setForm}
            />
          )}
          {form === 'sell' && !unlimited ? (
            <SellRam ctx={ctx} free={free} />
          ) : (
            <BuyRamPanel
              receiver={view.name}
              initialBytes={accountRamDefault(view.ram.usage, view.ram.quota)}
              onBought={ctx.afterSend}
              onFaucet={ctx.reload}
              byAmount
              blockedReason={ctx.viewOnly ? ctx.reason : undefined}
              commandView={(action) => <CommandView action={action} />}
            />
          )}
        </>
      )}
    </section>
  )
}

function SellRam({ ctx, free }: { ctx: WalletContext; free: number }): React.JSX.Element {
  const { view } = ctx
  const { price } = useRamMarket()
  const market = price && price.available ? price : null
  const [bytesText, setBytesText] = useState('1024')
  const [touched, setTouched] = useState(false)
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const { busy, message, send } = useSend(ctx.afterSend)
  const bytes = /^\d{1,10}$/.test(bytesText) ? Number(bytesText) : NaN
  const bytesOk = Number.isInteger(bytes) && bytes >= 1 && bytes <= free
  const back = market && bytesOk ? ramSellReturn(market, bytes) : null

  const action: TxAction | null =
    bytesOk && NAME.test(permission)
      ? { account: 'eosio', name: 'sellram', authorization: [{ actor: view.name, permission }], data: { account: view.name, bytes } }
      : null

  const sell = async (): Promise<void> => {
    setTouched(true)
    if (ctx.viewOnly || !action) return
    await send([action], `${bytes.toLocaleString()} bytes of RAM sold.`, () => setTouched(false))
  }

  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Sell RAM of {view.name}</div>
      <div className="hint">Only RAM the account does not use can be sold: {free.toLocaleString()} bytes now.</div>
      <div className="buy-ram-fields">
        <div className="field buy-ram-bytes">
          <label>Bytes</label>
          <input
            className="input mono"
            inputMode="numeric"
            value={bytesText}
            onChange={(e) => setBytesText(e.target.value.replace(/[\s,.]/g, ''))}
            onBlur={() => setTouched(true)}
          />
          {touched && !bytesOk && <div className="acct-note bad">Enter a whole number of bytes from 1 to {free.toLocaleString()}.</div>}
        </div>
        <div className="field buy-ram-bytes">
          <label>Permission</label>
          <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
        </div>
      </div>
      <div className="buy-ram-lines">
        <span>You get: {market && back !== null ? `about ${formatUnits(back, market.precision, market.symbol)} (after the 0.5% fee)` : '-'}</span>
      </div>
      <div className="buy-ram-actions">
        <button className="btn primary" disabled={busy || ctx.viewOnly || !action} onClick={() => void sell()}>
          {busy ? 'Waiting for confirmation...' : 'Sell RAM'}
        </button>
      </div>
      <ViewOnlyLine ctx={ctx} />
      <SendLine message={message} />
      <CommandView action={action} />
    </div>
  )
}
