// CPU and NET: stake (delegatebw) to this account or another one, unstake
// (undelegatebw), the refund in progress with its time, and Claim refund (refund).
// Stake and Unstake are one form at a time, chosen by a switch.

import { useEffect, useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import { amountField, amountUnits, assetUnits, formatUnits } from '../../../../shared/wallet'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { AccountPicker, PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, fmtBytes, fmtTime, fmtUs, FormSwitch, Gauge, NAME, pct, recipientProblem, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'
import { amountNote, CLEARED_FIELD, refundBlocked, refundTimeText, type AmountField } from './wallet-form'

interface Delegation {
  to: string
  cpu: string
  net: string
}

/** Units of an amount field; an empty field counts as zero. */
function fieldUnits(f: AmountField, precision: number): bigint | null {
  return f.text.trim() === '' ? 0n : amountUnits(f.text, precision)
}

export function CpuNetSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const symbol = view.symbol
  const precision = net?.precision ?? 8
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  const [delError, setDelError] = useState('')
  const [unstakeFill, setUnstakeFill] = useState<Delegation | null>(null)
  const [form, setForm] = useState<'stake' | 'unstake'>('stake')

  // The stakes list, read with the account (and again with each read after a send).
  useEffect(() => {
    let live = true
    setDelError('')
    window.wax.contract
      .rows({ account: 'eosio', table: 'delband', scope: view.name, lower: '', upper: '', limit: 100, index: '', keyType: '', reverse: false })
      .then(
        (r) => {
          if (!live) return
          const list: Delegation[] = []
          for (const row of r.rows) {
            if (!row || typeof row !== 'object') continue
            const o = row as Record<string, unknown>
            if (typeof o.to !== 'string' || !NAME.test(o.to)) continue
            list.push({ to: o.to, cpu: typeof o.cpu_weight === 'string' ? o.cpu_weight : '', net: typeof o.net_weight === 'string' ? o.net_weight : '' })
          }
          setDelegations(list)
        },
        (e) => live && setDelError(errorText(e))
      )
    return () => {
      live = false
    }
  }, [view, ctx.readTick])

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>CPU / NET</h3>
        <HelpButton place="walletCpuNet" />
      </div>
      <p className="wallet-lead">
        Staking locks tokens to give an account CPU time and network bandwidth for its transactions; unstaking starts a refund, and the tokens can be claimed back about
        three days later.
      </p>
      <div className="card-list">
        <Gauge label={`CPU (staked ${view.cpuWeight})`} text={`${fmtUs(view.cpu.used)} / ${fmtUs(view.cpu.max)}`} value={pct(view.cpu.used, view.cpu.max)} />
        <Gauge label={`NET (staked ${view.netWeight})`} text={`${fmtBytes(view.net.used)} / ${fmtBytes(view.net.max)}`} value={pct(view.net.used, view.net.max)} />
        <div className="kv-row">
          <span>Staked by {view.name} to itself</span>
          <span className="num">
            CPU {view.cpuSelf} / NET {view.netSelf}
          </span>
        </div>
        <div className="kv-row">
          <span>Staked by others</span>
          <span className="num">{view.stakedByOthers}</span>
        </div>
      </div>
      <Refund ctx={ctx} />
      <div className="buy-ram">
        <div className="buy-ram-title">Staked by {view.name}</div>
        {delError && <div className="hint">The list could not be read: {delError}</div>}
        {!delegations && !delError && <div className="hint">Reading...</div>}
        {delegations && delegations.length === 0 && <div className="hint">{view.name} has no stake to any account.</div>}
        {delegations && delegations.length > 0 && (
          <div className="card-list">
            {delegations.map((d) => (
              <div key={d.to} className="kv-row">
                <span className="mono">{d.to}</span>
                <span className="num">
                  CPU {d.cpu} / NET {d.net}{' '}
                  <button
                    className="btn subtle sm"
                    disabled={ctx.viewOnly}
                    title={ctx.viewOnly ? ctx.reason : 'Fill the unstake form'}
                    onClick={() => {
                      setUnstakeFill({ ...d })
                      setForm('unstake')
                    }}
                  >
                    Unstake...
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <FormSwitch
        label="CPU and NET form"
        value={form}
        options={[
          { id: 'stake', label: 'Stake' },
          { id: 'unstake', label: 'Unstake' }
        ]}
        onChange={setForm}
      />
      {form === 'stake' ? <Stake ctx={ctx} symbol={symbol} precision={precision} /> : <Unstake ctx={ctx} symbol={symbol} precision={precision} fill={unstakeFill} />}
    </section>
  )
}

function Refund({ ctx }: { ctx: WalletContext }): React.JSX.Element | null {
  const { view } = ctx
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const { busy, message, send } = useSend(ctx.afterSend)
  // The countdown starts at the moment of the read: chain time decides, not the PC clock.
  const [readAt, setReadAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setReadAt(Date.now())
    setNow(Date.now())
  }, [view])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!view.refundRequested) return message ? <SendLine message={message} /> : null
  const since = (now - readAt) / 1000
  const isDue = since >= view.refundSecondsLeft
  // The local due time shown: the moment of the read plus the seconds the chain still counts.
  const dueText = fmtTime(new Date(readAt + Math.max(0, view.refundSecondsLeft) * 1000).toISOString())
  const blocked = refundBlocked(view.refundExact, view.refundSecondsLeft, since)
  const action: TxAction | null = NAME.test(permission)
    ? { account: 'eosio', name: 'refund', authorization: [{ actor: view.name, permission }], data: { owner: view.name } }
    : null
  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Refund in progress</div>
      <div className="buy-ram-lines">
        <span>
          {view.refund} (CPU {view.refundCpu} / NET {view.refundNet})
        </span>
        <span>Unstaked {fmtTime(view.refundRequested)}</span>
        <span>{refundTimeText(view.refundExact, isDue, dueText, fmtTime(view.refundRequested))}</span>
      </div>
      <div className="buy-ram-actions">
        <div className="perm-inline">
          <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
        </div>
        <button
          className="btn"
          disabled={busy || ctx.viewOnly || blocked || !action}
          title={blocked ? 'The refund is not due yet' : undefined}
          onClick={() => action && void send([action], 'Refund claimed.')}
        >
          {busy ? 'Waiting for confirmation...' : 'Claim refund'}
        </button>
      </div>
      {blocked && !ctx.viewOnly && <div className="acct-note">Claim refund is possible once the refund time has passed.</div>}
      {!view.refundExact && <div className="acct-note">The chain refuses the claim while its waiting time runs.</div>}
      <ViewOnlyLine ctx={ctx} />
      <SendLine message={message} />
      <CommandView action={action} />
    </div>
  )
}

function Stake({ ctx, symbol, precision }: { ctx: WalletContext; symbol: string; precision: number }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const [from, setFrom] = useState(view.name)
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [receiver, setReceiver] = useState(view.name)
  const [cpu, setCpu] = useState<AmountField>(CLEARED_FIELD)
  const [netAmt, setNetAmt] = useState<AmountField>(CLEARED_FIELD)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, message, send } = useSend(ctx.afterSend)

  const cpuU = fieldUnits(cpu, precision)
  const netU = fieldUnits(netAmt, precision)
  const valid = cpuU !== null && netU !== null && cpuU + netU > 0n
  const available = from === view.name ? assetUnits(view.liquid, precision, symbol) : null
  const tooMuch = valid && available !== null && cpuU + netU > available
  const touched = cpu.touched || netAmt.touched
  const fieldNote = amountNote(cpu, precision, false) || amountNote(netAmt, precision, false)
  const action: TxAction | null =
    valid && NAME.test(from) && NAME.test(permission) && NAME.test(receiver)
      ? {
          account: 'eosio',
          name: 'delegatebw',
          authorization: [{ actor: from, permission }],
          data: {
            from,
            receiver,
            stake_net_quantity: formatUnits(netU, precision, symbol),
            stake_cpu_quantity: formatUnits(cpuU, precision, symbol),
            transfer: false
          }
        }
      : null

  const submit = async (): Promise<void> => {
    setCpu((f) => ({ ...f, touched: true }))
    setNetAmt((f) => ({ ...f, touched: true }))
    if (ctx.viewOnly || !action) return
    const p = receiver === from ? null : await recipientProblem(receiver, net?.name ?? 'this network')
    setProblem(p)
    if (p) return
    await send([action], `Staked to ${receiver}.`, () => {
      // A sent form is empty and untouched: nothing is red after a success.
      setCpu(CLEARED_FIELD)
      setNetAmt(CLEARED_FIELD)
      setProblem(null)
    })
  }

  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Stake</div>
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
        {from === view.name && <div className="acct-note">Available: {view.liquid}</div>}
      </div>
      <div className="field">
        <label>Receiver (gets the CPU and NET)</label>
        <AccountPicker mode="other" value={receiver} onChange={(v) => (setReceiver(v), setProblem(null))} />
        {problem && <div className="acct-note bad">{problem}</div>}
      </div>
      <AmountPair symbol={symbol} cpu={cpu} net={netAmt} setCpu={setCpu} setNet={setNetAmt} />
      {fieldNote ? (
        <div className="acct-note bad">{fieldNote}</div>
      ) : (
        touched && !valid && <div className="acct-note bad">Enter an amount above zero for CPU or NET, with at most {precision} decimals.</div>
      )}
      {tooMuch && <div className="acct-note bad">More than the available balance of {from}.</div>}
      <div className="buy-ram-actions">
        <button className="btn primary" disabled={busy || ctx.viewOnly || !action || tooMuch} onClick={() => void submit()}>
          {busy ? 'Waiting for confirmation...' : 'Stake'}
        </button>
      </div>
      <ViewOnlyLine ctx={ctx} />
      <SendLine message={message} />
      <CommandView action={action} />
    </div>
  )
}

function AmountPair({
  symbol,
  cpu,
  net,
  setCpu,
  setNet
}: {
  symbol: string
  cpu: AmountField
  net: AmountField
  setCpu: (f: (x: AmountField) => AmountField) => void
  setNet: (f: (x: AmountField) => AmountField) => void
}): React.JSX.Element {
  return (
    <div className="field-row">
      <div className="field">
        <label>CPU ({symbol})</label>
        <input
          className="input mono"
          inputMode="decimal"
          value={cpu.text}
          placeholder="0"
          onChange={(e) => {
            const text = e.target.value.trim()
            setCpu((f) => ({ ...f, text }))
          }}
          onBlur={() => setCpu((f) => ({ ...f, touched: true }))}
        />
      </div>
      <div className="field">
        <label>NET ({symbol})</label>
        <input
          className="input mono"
          inputMode="decimal"
          value={net.text}
          placeholder="0"
          onChange={(e) => {
            const text = e.target.value.trim()
            setNet((f) => ({ ...f, text }))
          }}
          onBlur={() => setNet((f) => ({ ...f, touched: true }))}
        />
      </div>
    </div>
  )
}

function Unstake({ ctx, symbol, precision, fill }: { ctx: WalletContext; symbol: string; precision: number; fill: Delegation | null }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [receiver, setReceiver] = useState(view.name)
  const [cpu, setCpu] = useState<AmountField>(CLEARED_FIELD)
  const [netAmt, setNetAmt] = useState<AmountField>(CLEARED_FIELD)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, message, send } = useSend(ctx.afterSend)

  useEffect(() => {
    if (!fill) return
    setReceiver(fill.to)
    const c = assetUnits(fill.cpu, precision, symbol)
    const n = assetUnits(fill.net, precision, symbol)
    setCpu({ text: c === null ? '' : amountField(c, precision), touched: false })
    setNetAmt({ text: n === null ? '' : amountField(n, precision), touched: false })
    setProblem(null)
  }, [fill, precision, symbol])

  const cpuU = fieldUnits(cpu, precision)
  const netU = fieldUnits(netAmt, precision)
  const valid = cpuU !== null && netU !== null && cpuU + netU > 0n
  const touched = cpu.touched || netAmt.touched
  const fieldNote = amountNote(cpu, precision, false) || amountNote(netAmt, precision, false)
  const action: TxAction | null =
    valid && NAME.test(permission) && NAME.test(receiver)
      ? {
          account: 'eosio',
          name: 'undelegatebw',
          authorization: [{ actor: view.name, permission }],
          data: {
            from: view.name,
            receiver,
            unstake_net_quantity: formatUnits(netU, precision, symbol),
            unstake_cpu_quantity: formatUnits(cpuU, precision, symbol)
          }
        }
      : null

  const submit = async (): Promise<void> => {
    setCpu((f) => ({ ...f, touched: true }))
    setNetAmt((f) => ({ ...f, touched: true }))
    if (ctx.viewOnly || !action) return
    const p = receiver === view.name ? null : await recipientProblem(receiver, net?.name ?? 'this network')
    setProblem(p)
    if (p) return
    await send([action], `Unstaked from ${receiver}; the refund has started.`, () => {
      // A sent form is empty and untouched: nothing is red after a success.
      setCpu(CLEARED_FIELD)
      setNetAmt(CLEARED_FIELD)
      setProblem(null)
    })
  }

  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Unstake</div>
      <div className="field">
        <label>From {view.name}, permission</label>
        <div className="perm-inline">
          <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
        </div>
      </div>
      <div className="field">
        <label>Receiver (the account the stake was given to)</label>
        <AccountPicker mode="other" value={receiver} onChange={(v) => (setReceiver(v), setProblem(null))} />
        {problem && <div className="acct-note bad">{problem}</div>}
      </div>
      <AmountPair symbol={symbol} cpu={cpu} net={netAmt} setCpu={setCpu} setNet={setNetAmt} />
      {fieldNote ? (
        <div className="acct-note bad">{fieldNote}</div>
      ) : (
        touched && !valid && <div className="acct-note bad">Enter an amount above zero for CPU or NET, with at most {precision} decimals.</div>
      )}
      {view.refundRequested && <div className="acct-note warn">A new unstake starts the waiting time again for the whole refund.</div>}
      <div className="buy-ram-actions">
        <button className="btn primary" disabled={busy || ctx.viewOnly || !action} onClick={() => void submit()}>
          {busy ? 'Waiting for confirmation...' : 'Unstake'}
        </button>
      </div>
      <ViewOnlyLine ctx={ctx} />
      <SendLine message={message} />
      <CommandView action={action} />
    </div>
  )
}
