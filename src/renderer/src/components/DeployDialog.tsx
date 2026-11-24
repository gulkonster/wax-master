import { useEffect, useRef, useState } from 'react'
import { DEPLOY_PLAN_EXPIRED, type DeployPlan } from '../../../shared/chain-types'
import type { InspectedTransaction } from '../../../shared/trace-types'
import type { OpenProject } from '../../../shared/api'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { ensureBuild } from '../lib/build'
import { withVault } from '../lib/vault'
import { emit } from '../lib/bus'
import { isUnlockCancelled } from '../../../shared/vault-locked'
import { ACCOUNT_NAME, AccountPicker, PermissionPicker, usePickList } from './AccountPicker'
import { BuyRamPanel, useRamMarket } from './BuyRamPanel'
import { FaucetButton } from './FaucetButton'
import { ramToBuy } from '../../../shared/ram-market'
import { useApp } from '../state'
import { lastOpened } from './ChainButtons'
import { lastDeployPick, preselectAccount, rememberDeployPick } from '../lib/deploy-account'

function short(h: string | null): string {
  return h ? `${h.slice(0, 16)}…${h.slice(-8)}` : '(none)'
}

function clock(t: number | null): string {
  return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

export function DeployDialog({
  project,
  askAccount,
  showPanel,
  onClose
}: {
  project: OpenProject
  askAccount: boolean
  showPanel: (t: 'output' | 'problems') => void
  onClose: () => void
}): React.JSX.Element {
  const { actions } = useApp()
  const nets = useStore(networkStore)
  const net = nets.current
  const topAccount = useStore(lastOpened).account
  const saved = net ? project.config.deploy.networks[net.id] : undefined
  const initialAccount = (): string => (net ? preselectAccount(saved?.account, topAccount, lastDeployPick(project.path, net.id), nets.stars) : '')
  const [account, setAccount] = useState(initialAccount)
  const [permission, setPermission] = useState(() => (saved?.account && saved.account === initialAccount() && saved.permission) || 'active')
  // Stars may arrive after the dialog opened: the preselection is made once they do, until the user picks.
  const picked = useRef(false)
  useEffect(() => {
    if (picked.current || account) return
    const a = initialAccount()
    if (!a) return
    setAccount(a)
    setPermission((a === saved?.account && saved?.permission) || 'active')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net?.id, nets.stars, topAccount])
  const pickAccount = (a: string): void => {
    picked.current = true
    if (net) rememberDeployPick(project.path, net.id, a)
    setAccount(a)
    setPlan(null)
  }
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [busy, setBusy] = useState<null | 'ensure' | 'rebuild' | 'plan' | 'simulate' | 'deploy'>(null)
  const [buildLine, setBuildLine] = useState('')
  const [buyOpen, setBuyOpen] = useState(false)
  const [ramNote, setRamNote] = useState('')
  const { price: ramPrice } = useRamMarket()
  const target = project.config.deploy.target
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)

  const valid = ACCOUNT_NAME.test(account) && ACCOUNT_NAME.test(permission)
  const { list } = usePickList()
  const entry = list?.entries.find((e) => e.account === account)
  // A starred account without a vault key can be picked (Simulate works); Deploy needs the key.
  const keyMissing = !!list && list.vaultChecked && valid && !(entry?.signable ?? []).includes(permission)
  const findAccount = (): void => {
    emit('find-account', { label: askAccount ? 'Deploy to Account' : 'Deploy', command: askAccount ? 'deploy-to-account' : 'deploy' })
    onClose()
  }

  /** Compares the built files on disk with the account (no compile) and shows the new plan. */
  const loadPlan = async (): Promise<DeployPlan | null> => {
    if (!net) return null
    const p = await window.wax.deploy.plan({ networkId: net.id, account, permission, target })
    setPlan(p)
    return p
  }

  /** Runs an operation on the plan; a plan that is used up or too old is prepared again from the same build first. */
  const withPlan = async <T,>(id: string, run: (planId: string) => Promise<T>): Promise<T> => {
    try {
      return await run(id)
    } catch (e) {
      if (!errorText(e).includes(DEPLOY_PLAN_EXPIRED)) throw e
      const fresh = await loadPlan()
      if (!fresh) throw e
      return run(fresh.id)
    }
  }

  // Build only when needed (always for Rebuild), then compare with the account.
  const runCheck = async (always: boolean): Promise<void> => {
    if (!net || !valid) return
    setError('')
    setTrace(null)
    setPlan(null)
    setBuildLine('')
    setBuyOpen(false)
    setRamNote('')
    try {
      setBusy(always ? 'rebuild' : 'ensure')
      const r = await ensureBuild(showPanel, always)
      if (!r) {
        setError('The build could not start or another build is running; see Output.')
        return
      }
      if (r.build?.needsApproval) {
        setError('Build cancelled: the custom build command was not approved.')
        return
      }
      if (r.result !== 'ok' && r.result !== 'abi-not-deployable') {
        setError('The build failed; nothing to deploy. See Output and Problems.')
        if (r.build?.problems.length) showPanel('problems')
        return
      }
      // B37: "Built" only when this check compiled; otherwise the stored build is up to date.
      setBuildLine(r.build ? `Built ${clock(r.builtAt)}` : `Build is up to date (built ${clock(r.builtAt)})`)
      // The stored ABI explanation is shown at once; a WASM-only deployment is still allowed.
      if (r.result === 'abi-not-deployable' && target !== 'wasm') {
        setError(r.abiFindings.map((f) => f.text).join('\n\n') || 'The ABI of this build cannot be deployed; see Output.')
        return
      }
      setBusy('plan')
      await loadPlan()
      if (!askAccount && (saved?.account !== account || saved?.permission !== permission)) {
        const cfg = { ...project.config, deploy: { ...project.config.deploy, networks: { ...project.config.deploy.networks, [net.id]: { account, permission } } } }
        // The window's copy of the project follows, so the dialog opens with this account next time.
        actions.projectUpdated(await window.wax.projects.saveConfig(cfg))
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  // One check at a time; a newer request replaces one that has not started yet.
  const seq = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const check = (always: boolean): void => {
    const id = ++seq.current
    queue.current = queue.current.then(() => (id === seq.current ? runCheck(always) : undefined))
  }

  // Opening the dialog and choosing an account or permission compare at once (no needless build).
  useEffect(() => {
    if (!valid || !net) return
    const t = setTimeout(() => check(false), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, permission, net?.id])

  // After RAM was bought: the comparison is read again, without building.
  const refreshPlan = async (): Promise<void> => {
    setBusy('plan')
    setError('')
    try {
      await loadPlan()
      setRamNote('RAM bought; the comparison was read again.')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const simulate = async (): Promise<void> => {
    if (!plan) return
    setBusy('simulate')
    setError('')
    try {
      setTrace(await withPlan(plan.id, (id) => window.wax.deploy.simulate(id)))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const deploy = async (): Promise<void> => {
    if (!plan) return
    setBusy('deploy')
    setError('')
    try {
      // A locked vault is asked for here; the same plan is sent after the unlock. A plan that
      // was used up by an earlier attempt is prepared again from the same build (no compile).
      const r = await withPlan(plan.id, (id) => withVault(() => window.wax.deploy.run(id)))
      setPlan(null)
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Deployed', `${account} on ${net?.name}`, 'success')
      } else {
        // The plan is used up: it is prepared again from the same build, so Deploy can be pressed again.
        await loadPlan().catch(() => undefined)
        if (r.status === 'failed') {
          setError(r.error)
          if (r.trace) setTrace(r.trace)
        } else setError('Cancelled; nothing was sent.')
      }
    } catch (e) {
      // Failed after the plan was used (for example a network error while the transaction was
      // prepared): the plan is prepared again from the same build, so Deploy can be pressed again.
      await loadPlan().catch(() => undefined)
      if (!isUnlockCancelled(e)) setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const nothing = plan && !plan.sendWasm && !plan.sendAbi
  const ramShort = plan && plan.ramAvailable >= 0 && plan.ramNeeded > plan.ramAvailable

  return (
    <Modal
      size="l"
      name="deploy"
      title={askAccount ? 'Deploy to Account' : 'Deploy'}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <div className="left">
            <button className="btn" disabled={!valid || !!busy || !net} title="Compile the project again, then compare with the account" onClick={() => check(true)}>
              {busy === 'rebuild' ? 'Building...' : busy === 'ensure' || busy === 'plan' ? 'Checking...' : 'Rebuild'}
            </button>
            <button className="btn" disabled={!plan || !!nothing || !!busy} onClick={() => void simulate()}>
              {busy === 'simulate' ? 'Simulating...' : 'Simulate Deploy'}
            </button>
          </div>
          <button className="btn" disabled={!!busy} onClick={onClose}>
            Close
          </button>
          <button className={`btn ${net?.kind === 'mainnet' ? 'danger' : 'primary'}`} disabled={!plan || !!nothing || !!busy} onClick={() => void deploy()}>
            {busy === 'deploy' ? 'Waiting for confirmation...' : 'Deploy'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Network</label>
        <div className={`chip ui one-line${net?.kind === 'mainnet' ? ' mainnet-text' : ''}`}>{net ? `${net.name} · ${net.endpoints[net.currentEndpoint]}` : '(none)'}</div>
      </div>
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 2 }}>
          <label>Account</label>
          <AccountPicker mode="starred" value={account} onChange={pickAccount} onFind={findAccount} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <PermissionPicker account={account} value={permission} onChange={(p) => (setPermission(p), setPlan(null))} />
        </div>
      </div>
      {keyMissing && (
        <div className="acct-note">
          The vault has no key for {account}@{permission}. Simulate works; Deploy needs the key.
          <button className="btn subtle sm" onClick={() => emit('open-keys', account)}>
            Import key
          </button>
        </div>
      )}
      <div className="hint">
        Deploys {project.config.deploy.target === 'both' ? 'WASM and ABI' : project.config.deploy.target === 'wasm' ? 'WASM only' : 'ABI only'} (Project Settings).{' '}
        {buildLine ? `${buildLine}.` : 'The project is built first if it changed.'}
      </div>
      {plan && (
        <div className="deploy-plan">
          {plan.wasmSha256 || plan.wasmFile !== null ? (
            <div className="plan-file">
              <div className="plan-file-name">WASM</div>
              <div className="plan-lines">
                <span>This build (SHA-256)</span>
                <span className="mono-small" title={plan.wasmSha256 ?? ''}>
                  {short(plan.wasmSha256)} {plan.wasmSize !== null && `(${plan.wasmSize.toLocaleString()} B)`}
                </span>
                <span>On the account now</span>
                <span className="mono-small" title={plan.chainCodeHash}>{short(plan.chainCodeHash || null)}</span>
                <span>Sent</span>
                <span>{plan.sendWasm ? 'yes (setcode)' : 'unchanged'}</span>
              </div>
            </div>
          ) : null}
          {plan.abiSha256 && (
            <div className="plan-file">
              <div className="plan-file-name">ABI</div>
              <div className="plan-lines">
                <span>This build (SHA-256)</span>
                <span className="mono-small" title={plan.abiSha256 ?? ''}>
                  {short(plan.abiSha256)} {plan.abiSize !== null && `(${plan.abiSize.toLocaleString()} B)`}
                </span>
                <span>On the account now</span>
                <span className="mono-small" title={plan.chainAbiHash}>{short(plan.chainAbiHash || null)}</span>
                <span>Sent</span>
                <span>{plan.sendAbi ? 'yes (setabi)' : 'unchanged'}</span>
              </div>
            </div>
          )}
          {nothing && <div className="c-done">Nothing to deploy: the account already has this build.</div>}
          {!nothing && !ramShort && (
            <div className="hint">
              RAM needed about {plan.ramNeeded.toLocaleString()} bytes; available {plan.ramAvailable < 0 ? 'unlimited' : `${plan.ramAvailable.toLocaleString()} bytes`}.
            </div>
          )}
          {!nothing && ramShort && (
            <div className="banner warn ram-warn">
              <span className="grow">
                RAM needed about {plan.ramNeeded.toLocaleString()} bytes; available {plan.ramAvailable.toLocaleString()} bytes.
              </span>
              {!buyOpen && (
                <span className="ram-warn-actions">
                  {ramPrice?.available && (
                    <button className="btn" disabled={!!busy} onClick={() => setBuyOpen(true)}>
                      Buy RAM
                    </button>
                  )}
                  <FaucetButton account={plan.account} />
                </span>
              )}
            </div>
          )}
          {!nothing && ramShort && buyOpen && ramPrice?.available && (
            <BuyRamPanel
              receiver={plan.account}
              initialBytes={ramToBuy(plan.ramNeeded, plan.ramAvailable)}
              onBought={() => void refreshPlan()}
              onClose={() => setBuyOpen(false)}
            />
          )}
          {ramNote && <div className="hint">{ramNote}</div>}
          {plan.missingFeatures.length > 0 && (
            <div className="c-blocked">
              The contract calls host functions that {plan.network} has not activated:{' '}
              {plan.missingFeatures.map((m) => `${m.name} (${m.feature})`).join(', ')}. The deployment would fail or the actions would not run.
            </div>
          )}
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
      {trace && (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <InspectorBody t={trace} />
        </div>
      )}
    </Modal>
  )
}
