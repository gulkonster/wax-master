// Linked actions: which contract action needs which permission of this account
// (linkauth). The list comes from the node, or from the history service when
// the node does not report it. Link and Unlink go through the change dialog.

import { useCallback, useEffect, useState } from 'react'
import type { LinkedActionsView } from '../../../../shared/chain-types'
import { HelpButton } from '../../components/HelpButton'
import { AccountPicker } from '../../components/AccountPicker'
import { errorText } from '../../lib/toast'
import { NAME, ViewOnlyLine, type WalletContext } from './common'
import { PermissionChangeDialog, type ChangeStart } from './PermissionChange'

export function LinksSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const [links, setLinks] = useState<LinkedActionsView | null>(null)
  const [error, setError] = useState('')
  const [change, setChange] = useState<ChangeStart | null>(null)
  // Link form.
  const [contract, setContract] = useState('')
  const [actions, setActions] = useState<string[] | null>(null)
  const [abiNote, setAbiNote] = useState('')
  const [action, setAction] = useState('')
  const linkable = view.permissions.map((p) => p.name).filter((p) => p !== 'owner')
  const [requirement, setRequirement] = useState(linkable.find((p) => p !== 'active') ?? linkable[0] ?? 'active')

  const load = useCallback(async () => {
    setError('')
    try {
      setLinks(await window.wax.wallet.links(view.name))
    } catch (e) {
      setLinks(null)
      setError(errorText(e))
    }
  }, [view.name])

  useEffect(() => {
    void load()
  }, [load, view])

  const readAbi = async (c: string): Promise<void> => {
    setActions(null)
    setAbiNote('')
    if (!NAME.test(c)) return
    try {
      const abi = await window.wax.contract.abi(c)
      if (!abi.hasAbi) {
        setAbiNote(`${c} has no contract (no ABI) on this network.`)
        return
      }
      const names = abi.actions.map((a) => a.name)
      setActions(names)
      setAction((a) => (names.includes(a) ? a : (names[0] ?? '')))
    } catch (e) {
      setAbiNote(`The ABI of ${c} could not be read: ${errorText(e)}`)
    }
  }

  // The actions are read from the contract's ABI once the name is typed.
  useEffect(() => {
    const t = setTimeout(() => void readAbi(contract), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract])

  const disabled = ctx.viewOnly
  const ready = NAME.test(contract) && !!actions && actions.includes(action) && NAME.test(requirement)

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Linked actions</h3>
        <HelpButton place="walletLinks" />
      </div>
      <p className="wallet-lead">
        A linked action can be signed with a smaller permission of its own instead of active, for example a <span className="mono">claim</span> permission for one
        game action.
      </p>
      {error && <div className="error-text">{error}</div>}
      {links && (
        <div className="card-list">
          {links.rows.length === 0 ? (
            <div className="kv-row">
              <span className="hint">
                {links.source === 'none' ? 'The node does not report linked actions and this network has no history service.' : 'No action is linked.'}
              </span>
            </div>
          ) : (
            links.rows.map((l) => (
              <div key={`${l.contract}::${l.action}`} className="token-row">
                <span className="mono">
                  {l.contract}::{l.action || '(every action)'}
                </span>
                <span className="mono">
                  {view.name}@{l.permission}
                </span>
                <button
                  className="btn subtle sm"
                  disabled={disabled}
                  title={disabled ? ctx.reason : undefined}
                  onClick={() => setChange({ intent: { kind: 'unlink', account: view.name, code: l.contract, type: l.action }, links })}
                >
                  Unlink
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {links?.source === 'history' && <div className="hint">Read from the history service; a link made a moment ago may not be listed yet.</div>}

      <div className="wallet-form">
        <div className="buy-ram-title">Link an action to a permission</div>
        <div className="field-row">
          <div className="field">
            <label>Contract</label>
            <AccountPicker
              mode="other"
              value={contract}
              onChange={setContract}
            />
          </div>
          <div className="field">
            <label>Action</label>
            <select className="select" value={action} disabled={!actions} onChange={(e) => setAction(e.target.value)}>
              {!actions && <option value="">(enter the contract first)</option>}
              {(actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Permission</label>
            <select className="select" value={requirement} onChange={(e) => setRequirement(e.target.value)}>
              {linkable.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        {abiNote && <div className="acct-note">{abiNote}</div>}
        <div>
          <button
            className="btn primary"
            disabled={disabled || !ready}
            onClick={() => setChange({ intent: { kind: 'link', account: view.name, code: contract, type: action, requirement }, links })}
          >
            Link an action to a permission
          </button>
        </div>
        <ViewOnlyLine ctx={ctx} />
      </div>
      {change && <PermissionChangeDialog ctx={ctx} start={change} onClose={() => setChange(null)} onSent={() => void load()} />}
    </section>
  )
}
