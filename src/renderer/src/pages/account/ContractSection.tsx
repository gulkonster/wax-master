// Contract: what is deployed on the account (code hash, ABI hash, last code
// update) with Open as contract, Deploy (the current project, to this account)
// and Clear code.

import { useEffect, useState } from 'react'
import type { ContractInfoView } from '../../../../shared/chain-types'
import { emit } from '../../lib/bus'
import { errorText } from '../../lib/toast'
import { useApp } from '../../state'
import { HelpButton } from '../../components/HelpButton'
import { fmtTime, ViewOnlyLine, type WalletContext } from './common'

export function ContractSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const { state, actions } = useApp()
  const [info, setInfo] = useState<ContractInfoView | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    window.wax.wallet.contractInfo(view.name).then(
      (i) => live && setInfo(i),
      (e) => {
        if (!live) return
        setInfo(null)
        setError(errorText(e))
      }
    )
    return () => {
      live = false
    }
  }, [view])

  const openContract = (): void => {
    actions.setView('contract')
    setTimeout(() => emit('open-contract', view.name), 0)
  }
  const noProject = !state.project

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Contract</h3>
        <HelpButton place="walletContract" />
      </div>
      <p className="wallet-lead">The contract deployed on this account: its code and ABI as the chain has them.</p>
      {error && <div className="error-text">{error}</div>}
      {info && (
        <div className="card-list">
          <div className="kv-row">
            <span>Code hash</span>
            <span className="num wrap">{info.codeHash || 'no contract'}</span>
          </div>
          <div className="kv-row">
            <span>ABI hash</span>
            <span className="num wrap">{info.abiHash || 'no ABI'}</span>
          </div>
          <div className="kv-row">
            <span>Last code update</span>
            <span className="num">{info.lastCodeUpdate ? fmtTime(info.lastCodeUpdate) : '-'}</span>
          </div>
        </div>
      )}
      <div className="perm-buttons">
        <button className="btn subtle sm" disabled={!info?.hasCode} onClick={openContract}>
          Open as contract
        </button>
        <button
          className="btn subtle sm"
          disabled={noProject || ctx.viewOnly}
          title={noProject ? 'Open a project first: Deploy sends the current project.' : ctx.viewOnly ? ctx.reason : undefined}
          onClick={() => emit('deploy-for-account', view.name)}
        >
          Deploy to this account...
        </button>
        <button
          className="btn subtle sm"
          disabled={!info?.hasCode || ctx.viewOnly}
          title={ctx.viewOnly ? ctx.reason : undefined}
          onClick={() => emit('clear-code-for', view.name)}
        >
          Clear code
        </button>
      </div>
      {noProject && <div className="hint">Deploy sends the current project: open its folder first.</div>}
      <ViewOnlyLine ctx={ctx} />
    </section>
  )
}
