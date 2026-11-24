// Voting and rewards: the account's current vote, voting for producers (chosen
// from the active ones of the producers table) or through a proxy, one form at a
// time, and the reward claims the chain's system contract offers.

import { useEffect, useMemo, useState } from 'react'
import type { VoterClaimView, VotingView } from '../../../../shared/chain-types'
import { claimAction, voteAction } from '../../../../shared/wallet-voting'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { AccountPicker, PermissionPicker } from '../../components/AccountPicker'
import { HelpButton } from '../../components/HelpButton'
import { CommandView, FormSwitch, recipientProblem, SendLine, useSend, ViewOnlyLine, type WalletContext } from './common'

export function VotingSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const [data, setData] = useState<VotingView | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<'producers' | 'proxy'>('producers')

  useEffect(() => {
    let live = true
    setError('')
    window.wax.wallet.voting(view.name).then(
      (v) => {
        if (!live) return
        setData(v)
        if (v.current?.proxy) setForm('proxy')
      },
      (e) => live && setError(errorText(e))
    )
    return () => {
      live = false
    }
  }, [view.name, ctx.readTick])

  const current = data?.current ?? null
  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Voting and rewards</h3>
        <HelpButton place="walletVoting" />
      </div>
      <p className="wallet-lead">
        Staked tokens give an account votes for the block producers that run the chain. Vote for producers yourself, or let a proxy account vote for you; voting
        rewards, where the chain pays them, are claimed here.
      </p>
      {error && <div className="error-text">The voting data could not be read: {error}</div>}
      {!data && !error && <div className="hint">Reading...</div>}
      {data && (
        <>
          <div className="card-list">
            <div className="kv-row">
              <span>Current vote</span>
              <span className="num">
                {!current
                  ? 'none: the account has not voted'
                  : current.proxy
                    ? `through the proxy ${current.proxy}`
                    : current.producers.length
                      ? `${current.producers.length} producer${current.producers.length === 1 ? '' : 's'}`
                      : 'none'}
              </span>
            </div>
            {current && current.producers.length > 0 && <div className="hint mono">{current.producers.join(', ')}</div>}
            {current?.staked && (
              <div className="kv-row">
                <span>Staked (counts for the vote)</span>
                <span className="num">{current.staked}</span>
              </div>
            )}
            {current?.isProxy && <div className="hint">This account is registered as a proxy: other accounts can vote through it.</div>}
          </div>
          <Claims ctx={ctx} claims={data.claims} />
          <FormSwitch
            label="Voting form"
            value={form}
            options={[
              { id: 'producers', label: 'Producers' },
              { id: 'proxy', label: 'Proxy' }
            ]}
            onChange={setForm}
          />
          {form === 'producers' ? <VoteProducers ctx={ctx} data={data} /> : <VoteProxy ctx={ctx} current={current?.proxy ?? ''} />}
        </>
      )}
    </section>
  )
}

function Claims({ ctx, claims }: { ctx: WalletContext; claims: VoterClaimView[] }): React.JSX.Element {
  const { view } = ctx
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const { busy, message, send } = useSend(ctx.afterSend)
  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Rewards</div>
      {claims.length === 0 ? (
        <div className="hint">The system contract of this chain offers no reward claim for voters.</div>
      ) : (
        <>
          {claims.map((c) => {
            const action = claimAction(c, view.name, permission)
            return (
              <div key={c.action} className="card-list">
                <div className="kv-row">
                  <span>
                    {c.label} <span className="mono">({c.action})</span>
                  </span>
                  <span className="num">
                    <button
                      className="btn subtle sm"
                      disabled={busy || ctx.viewOnly || !action}
                      title={ctx.viewOnly ? ctx.reason : `Sends eosio::${c.action}`}
                      onClick={() => action && void send([action], `${c.label}: sent.`)}
                    >
                      Claim
                    </button>
                  </span>
                </div>
                <div className="hint">{c.dueText}</div>
                {c.timeNote && <div className="hint">{c.timeNote}</div>}
              </div>
            )
          })}
          <div className="buy-ram-actions">
            <div className="perm-inline">
              <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
            </div>
          </div>
          <ViewOnlyLine ctx={ctx} />
          <SendLine message={message} />
        </>
      )}
    </div>
  )
}

function VoteProducers({ ctx, data }: { ctx: WalletContext; data: VotingView }): React.JSX.Element {
  const { view } = ctx
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const initial = data.current && !data.current.proxy ? data.current.producers : []
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(initial))
  const [find, setFind] = useState('')
  const { busy, message, send } = useSend(ctx.afterSend)

  // A new read (after a sent vote) starts from the vote the chain now holds.
  const initialKey = initial.join(',')
  useEffect(() => {
    setChosen(new Set(initialKey ? initialKey.split(',') : []))
  }, [initialKey])

  const rank = useMemo(() => new Map(data.producers.map((p, i) => [p.name, i + 1])), [data.producers])
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return data.producers.filter((p) => !q || p.name.includes(q))
  }, [data.producers, find])
  // Producers of the current vote that are no longer active stay choosable, so they can be removed.
  const inactive = [...chosen].filter((p) => !rank.has(p)).sort()

  const removing = chosen.size === 0
  const built = voteAction(view.name, permission, { kind: 'producers', producers: [...chosen] }, data.maxProducers)
  const action = 'action' in built && !(removing && initial.length === 0) ? built.action : null
  const problem = 'problem' in built ? built.problem : ''

  const toggle = (name: string): void =>
    setChosen((s) => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })

  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Vote for producers</div>
      <div className="hint">
        Choose up to {data.maxProducers} producers from the active ones, listed by votes. A new vote replaces the whole earlier vote, including a proxy.
      </div>
      <div className="field-row">
        <div className="field">
          <label>Find</label>
          <input className="input mono" value={find} placeholder="producer name" onChange={(e) => setFind(e.target.value.slice(0, 13))} />
        </div>
        <div className="field">
          <label>Permission</label>
          <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
        </div>
      </div>
      <div className="acct-note">
        {chosen.size} of {data.maxProducers} chosen
      </div>
      <div className="producer-list" role="group" aria-label="Producers">
        {inactive.map((p) => (
          <label key={p} className="producer-row">
            <input type="checkbox" checked onChange={() => toggle(p)} />
            <span className="producer-rank">-</span>
            <span className="mono grow">{p}</span>
            <span className="hint">not active</span>
          </label>
        ))}
        {shown.map((p) => (
          <label key={p.name} className="producer-row">
            <input type="checkbox" checked={chosen.has(p.name)} onChange={() => toggle(p.name)} />
            <span className="producer-rank">{rank.get(p.name)}</span>
            <span className="mono grow">{p.name}</span>
            <span className="num">{p.votePercent.toFixed(2)} %</span>
          </label>
        ))}
        {shown.length === 0 && <div className="hint">No active producer matches.</div>}
      </div>
      {data.producersCut && <div className="hint">Only the first {data.producers.length} active producers by votes are listed.</div>}
      {problem && <div className="acct-note bad">{problem}</div>}
      <div className="buy-ram-actions">
        <button
          className="btn primary"
          disabled={busy || ctx.viewOnly || !action}
          onClick={() => action && void send([action], removing ? 'Vote removed.' : `Voted for ${chosen.size} producer${chosen.size === 1 ? '' : 's'}.`)}
        >
          {busy ? 'Waiting for confirmation...' : removing ? 'Remove the vote' : 'Vote'}
        </button>
      </div>
      <ViewOnlyLine ctx={ctx} />
      <SendLine message={message} />
      <CommandView action={action} />
    </div>
  )
}

function VoteProxy({ ctx, current }: { ctx: WalletContext; current: string }): React.JSX.Element {
  const { view } = ctx
  const net = useStore(networkStore).current
  const [permission, setPermission] = useState(view.control[0] ?? 'active')
  const [proxy, setProxy] = useState(current)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, message, send } = useSend(ctx.afterSend)
  useEffect(() => setProxy(current), [current])

  const built = voteAction(view.name, permission, { kind: 'proxy', proxy })
  const action = 'action' in built ? built.action : null

  const submit = async (): Promise<void> => {
    if (ctx.viewOnly || !action) return
    const p = await recipientProblem(proxy.trim(), net?.name ?? 'this network')
    setProblem(p)
    if (p) return
    await send([action], `Voting through the proxy ${proxy.trim()}.`)
  }

  return (
    <div className="buy-ram">
      <div className="buy-ram-title">Vote through a proxy</div>
      <div className="hint">A proxy is an account that votes for you: your stake counts for the producers it chooses. A proxy vote replaces a vote for producers.</div>
      <div className="field-row">
        <div className="field">
          <label>Proxy account</label>
          <AccountPicker mode="other" value={proxy} onChange={(v) => (setProxy(v), setProblem(null))} />
          {problem && <div className="acct-note bad">{problem}</div>}
          {!problem && proxy.trim() !== '' && 'problem' in built && <div className="acct-note bad">{built.problem}</div>}
        </div>
        <div className="field">
          <label>Permission</label>
          <PermissionPicker account={view.name} value={permission} onChange={setPermission} />
        </div>
      </div>
      <div className="buy-ram-actions">
        <button className="btn primary" disabled={busy || ctx.viewOnly || !action} onClick={() => void submit()}>
          {busy ? 'Waiting for confirmation...' : 'Vote through proxy'}
        </button>
      </div>
      <ViewOnlyLine ctx={ctx} />
      <SendLine message={message} />
      <CommandView action={action} />
    </div>
  )
}
