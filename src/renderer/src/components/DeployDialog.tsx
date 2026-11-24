import { useEffect, useState } from 'react'
import type { DeployPlan } from '../../../shared/chain-types'
import type { InspectedTransaction } from '../../../shared/trace-types'
import type { OpenProject } from '../../../shared/api'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { startBuild } from '../lib/build'

function short(h: string | null): string {
  return h ? `${h.slice(0, 16)}…${h.slice(-8)}` : '(none)'
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
  const net = useStore(networkStore).current
  const saved = net ? project.config.deploy.networks[net.id] : undefined
  const [account, setAccount] = useState(askAccount ? '' : (saved?.account ?? ''))
  const [permission, setPermission] = useState(saved?.permission || 'active')
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [busy, setBusy] = useState<null | 'build' | 'plan' | 'simulate' | 'deploy'>(null)
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)

  const valid = /^[a-z1-5.]{1,12}[a-j1-5]?$/.test(account) && /^[a-z1-5.]{1,12}[a-j1-5]?$/.test(permission)

  const check = async (): Promise<void> => {
    if (!net) return
    setError('')
    setTrace(null)
    setPlan(null)
    try {
      setBusy('build')
      const b = await startBuild(showPanel)
      if (!b || !b.ok) {
        setError('The build failed or was cancelled; nothing to deploy.')
        return
      }
      setBusy('plan')
      setPlan(await window.wax.deploy.plan({ networkId: net.id, account, permission, target: project.config.deploy.target }))
      if (!askAccount && (saved?.account !== account || saved?.permission !== permission)) {
        const cfg = { ...project.config, deploy: { ...project.config.deploy, networks: { ...project.config.deploy.networks, [net.id]: { account, permission } } } }
        await window.wax.projects.saveConfig(cfg)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (account && !askAccount && net) void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const simulate = async (): Promise<void> => {
    if (!plan) return
    setBusy('simulate')
    setError('')
    try {
      setTrace(await window.wax.deploy.simulate(plan.id))
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
      const r = await window.wax.deploy.run(plan.id)
      setPlan(null)
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Deployed', `${account} on ${net?.name}`, 'success')
      } else if (r.status === 'failed') {
        setError(r.error)
        if (r.trace) setTrace(r.trace)
      } else setError('Cancelled. Press Check again to prepare a new deployment.')
    } catch (e) {
      setError(errorText(e))
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
          <button className="btn" disabled={!!busy} onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={!valid || !!busy || !net} onClick={() => void check()}>
            {busy === 'build' ? 'Building...' : busy === 'plan' ? 'Checking...' : 'Build and check'}
          </button>
          <button className="btn" disabled={!plan || !!nothing || !!busy} onClick={() => void simulate()}>
            {busy === 'simulate' ? 'Simulating...' : 'Simulate Deploy'}
          </button>
          <button className={`btn ${net?.kind === 'mainnet' ? 'danger' : 'primary'}`} disabled={!plan || !!nothing || !!busy} onClick={() => void deploy()}>
            {busy === 'deploy' ? 'Waiting for confirmation...' : 'Deploy'}
          </button>
        </>
      }
    >
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 1 }}>
          <label>Network</label>
          <div className={`chip ui${net?.kind === 'mainnet' ? ' mainnet-text' : ''}`}>{net ? `${net.name} · ${net.endpoints[net.currentEndpoint]}` : '(none)'}</div>
        </div>
      </div>
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 2 }}>
          <label>Account</label>
          <input className="input mono" value={account} onChange={(e) => (setAccount(e.target.value.trim().toLowerCase()), setPlan(null))} placeholder="contract account" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <input className="input mono" value={permission} onChange={(e) => (setPermission(e.target.value.trim().toLowerCase()), setPlan(null))} />
        </div>
      </div>
      <div className="hint">Deploys {project.config.deploy.target === 'both' ? 'WASM and ABI' : project.config.deploy.target === 'wasm' ? 'WASM only' : 'ABI only'} (Project Settings). The project is built first if needed.</div>
      {plan && (
        <div className="deploy-plan">
          <table className="tx-table">
            <thead>
              <tr>
                <th />
                <th>This build (SHA-256)</th>
                <th>On the account now</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {plan.wasmFile !== null || plan.wasmSha256 ? (
                <tr>
                  <td>WASM</td>
                  <td className="mono-small" title={plan.wasmSha256 ?? ''}>
                    {short(plan.wasmSha256)} {plan.wasmSize !== null && `(${plan.wasmSize.toLocaleString()} B)`}
                  </td>
                  <td className="mono-small" title={plan.chainCodeHash}>{short(plan.chainCodeHash || null)}</td>
                  <td>{plan.sendWasm ? 'yes (setcode)' : 'unchanged'}</td>
                </tr>
              ) : null}
              {plan.abiSha256 && (
                <tr>
                  <td>ABI</td>
                  <td className="mono-small" title={plan.abiSha256}>
                    {short(plan.abiSha256)} {plan.abiSize !== null && `(${plan.abiSize.toLocaleString()} B)`}
                  </td>
                  <td className="mono-small" title={plan.chainAbiHash}>{short(plan.chainAbiHash || null)}</td>
                  <td>{plan.sendAbi ? 'yes (setabi)' : 'unchanged'}</td>
                </tr>
              )}
            </tbody>
          </table>
          {nothing && <div className="c-done">Nothing to deploy: the account already has this build.</div>}
          {!nothing && (
            <div className={ramShort ? 'error-text' : 'hint'}>
              RAM needed about {plan.ramNeeded.toLocaleString()} bytes; available {plan.ramAvailable < 0 ? 'unlimited' : `${plan.ramAvailable.toLocaleString()} bytes`}.
              {ramShort && ' Buy RAM for the account first (eosio buyrambytes on the Contract page).'}
            </div>
          )}
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
