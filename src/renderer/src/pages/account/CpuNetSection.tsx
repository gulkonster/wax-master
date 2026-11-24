// CPU and NET: stake (delegatebw) to this account or another one, unstake
// (undelegatebw), the refund in progress with its time, and Claim refund (refund)
// once it is due.

import { useEffect, useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import { formatUnits } from '../../../../shared/ram-market'
import { amountUnits, assetUnits } from '../../../../shared/wallet'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { AccountPicker, PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, fmtBytes, fmtTime, fmtUs, Gauge, NAME, pct, recipientProblem, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'

interface Delegation {
  to: string
  cpu: string
  net: string
}

/** Units of an amount field; an empty field counts as zero. */
function fieldUnits(text: string, precision: number): number | null {
  return text.trim() === '' ? 0 : amountUnits(text, precision)
}

export function CpuNetSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const symbol = view.symbol
  const precision = net?.precision ?? 8
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  const [delError, setDelError] = useState('')
  const [unstakeFill, setUnstakeFill] = useState<Delegation | null>(null)

  useEffect(() => {
    let live = true
    setDelegations(null)
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
  }, [view])

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
      <Stake ctx={ctx} symbol={symbol} precision={precision} />
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
                  <button className="btn subtle sm" disabled={ctx.viewOnly} title={ctx.viewOnly ? ctx.reason : 'Fill the unstake form'} onClick={() => setUnstakeFill({ ...d })}>
                    Unstake...
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <Unstake ctx={ctx} symbol={symbol} precision={precision} fill={unstakeFill} />
    </section>
  )
}

function Refund({ ctx }: { ctx: WalletContext }): React.JSX.Element | null {
  const { view } = ctx
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const { busy, message, send } = useSend()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!view.refundRequested) return message ? <SendLine message={message} /> : null
  const due = new Date(view.refundDue).getTime()
  const isDue = Number.isFinite(due) && now >= due
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
        <span>{isDue ? 'Can be claimed now.' : `Can be claimed from ${fmtTime(view.refundDue)}.`}</span>
      </div>
      <div className="buy-ram-actions">
        <div className="perm-inline">
          <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
        </div>
        <button
          className="btn primary"
          disabled={busy || ctx.viewOnly || !isDue || !action}
          title={!isDue ? 'The refund is not due yet' : undefined}
          onClick={() => action && void send([action], 'Refund claimed.', ctx.reload)}
        >
          {busy ? 'Waiting for confirmation...' : 'Claim refund'}
        </button>
      </div>
      {!isDue && !ctx.viewOnly && <div className="acct-note">Claim refund is possible once the refund time has passed.</div>}
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
  const [cpu, setCpu] = useState('')
  const [netAmt, setNetAmt] = useState('')
  const [touched, setTouched] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, message, send } = useSend()

  const cpuU = fieldUnits(cpu, precision)
  const netU = fieldUnits(netAmt, precision)
  const valid = cpuU !== null && netU !== null && cpuU + netU > 0
  const available = from === view.name ? assetUnits(view.liquid, precision, symbol) : null
  const tooMuch = valid && available !== null && cpuU + netU > available
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
    setTouched(true)
    if (ctx.viewOnly || !action) return
    const p = receiver === from ? null : await recipientProblem(receiver, net?.name ?? 'this network')
    setProblem(p)
    if (p) return
    await send([action], `Staked to ${receiver}.`, () => {
      setCpu('')
      setNetAmt('')
      ctx.reload()
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
      <div className="field-row">
        <div className="field">
          <label>CPU ({symbol})</label>
          <input className="input mono" inputMode="decimal" value={cpu} placeholder="0" onChange={(e) => setCpu(e.target.value.trim())} onBlur={() => setTouched(true)} />
        </div>
        <div className="field">
          <label>NET ({symbol})</label>
          <input className="input mono" inputMode="decimal" value={netAmt} placeholder="0" onChange={(e) => setNetAmt(e.target.value.trim())} onBlur={() => setTouched(true)} />
        </div>
      </div>
      {touched && !valid && <div className="acct-note bad">Enter an amount above zero for CPU or NET, with at most {precision} decimals.</div>}
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

function Unstake({ ctx, symbol, precision, fill }: { ctx: WalletContext; symbol: string; precision: number; fill: Delegation | null }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [receiver, setReceiver] = useState(view.name)
  const [cpu, setCpu] = useState('')
  const [netAmt, setNetAmt] = useState('')
  const [touched, setTouched] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, message, send } = useSend()

  useEffect(() => {
    if (!fill) return
    setReceiver(fill.to)
    const c = assetUnits(fill.cpu, precision, symbol)
    const n = assetUnits(fill.net, precision, symbol)
    setCpu(c === null ? '' : formatUnits(c, precision, symbol).split(' ')[0])
    setNetAmt(n === null ? '' : formatUnits(n, precision, symbol).split(' ')[0])
    setProblem(null)
  }, [fill, precision, symbol])

  const cpuU = fieldUnits(cpu, precision)
  const netU = fieldUnits(netAmt, precision)
  const valid = cpuU !== null && netU !== null && cpuU + netU > 0
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
    setTouched(true)
    if (ctx.viewOnly || !action) return
    const p = receiver === view.name ? null : await recipientProblem(receiver, net?.name ?? 'this network')
    setProblem(p)
    if (p) return
    await send([action], `Unstaked from ${receiver}; the refund has started.`, () => {
      setCpu('')
      setNetAmt('')
      ctx.reload()
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
      <div className="field-row">
        <div className="field">
          <label>CPU ({symbol})</label>
          <input className="input mono" inputMode="decimal" value={cpu} placeholder="0" onChange={(e) => setCpu(e.target.value.trim())} onBlur={() => setTouched(true)} />
        </div>
        <div className="field">
          <label>NET ({symbol})</label>
          <input className="input mono" inputMode="decimal" value={netAmt} placeholder="0" onChange={(e) => setNetAmt(e.target.value.trim())} onBlur={() => setTouched(true)} />
        </div>
      </div>
      {touched && !valid && <div className="acct-note bad">Enter an amount above zero for CPU or NET, with at most {precision} decimals.</div>}
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
