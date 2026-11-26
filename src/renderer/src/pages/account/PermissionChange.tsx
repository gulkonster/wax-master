// The dialog of every permission change of the wallet. The editor window only
// says what to change (an intent); the main process reads the account from the
// chain, builds the new authority, refuses a change that could lock the account
// out, and returns what will be sent. The full authority before and after is
// shown here and again in the confirmation window.

import { useEffect, useState } from 'react'
import type { AuthorityView, LinkedActionsView, PermissionIntent, PermissionPlanView, PermissionView } from '../../../../shared/chain-types'
import { allowedSigners, ancestryOf, defaultSigner } from '../../../../shared/permission-signers'
import type { InspectedTransaction } from '../../../../shared/trace-types'
import { isUnlockCancelled } from '../../../../shared/vault-locked'
import { Modal } from '../../components/Modal'
import { InspectorBody } from '../../components/Inspector'
import { HelpButton } from '../../components/HelpButton'
import { AccountPicker } from '../../components/AccountPicker'
import { KeyPicker, useVaultKeys } from '../../components/AccountDialogs'
import { NoBackupLine } from '../../components/BackupWarning'
import type { HelpPlace } from '../../lib/help-topics'
import { withVault } from '../../lib/vault'
import { errorText, toast } from '../../lib/toast'
import { CANCELLED_NOT_SENT, formLineClass, outcomeLine, type FormLine } from '../../lib/tx-outcome'
import { CommandView, NAME, type WalletContext } from './common'
import { addEntryWeightHint } from './wallet-form'
import { Busy } from '../../components/Busy'

/** What the dialog starts from: a form to fill, or a change that needs no fields. */
export type ChangeStart =
  | { form: 'addKey'; permission: string }
  | { form: 'addAccount'; permission: string }
  | { form: 'setThreshold'; permission: string }
  | { form: 'newPermission'; parent: string }
  /** `links`: the linked actions the section shows (Link and Unlink are signed by the permission the action needs). */
  | { intent: PermissionIntent; links?: LinkedActionsView | null }

/** The permission and its parents, nearest first. */
export function ancestry(perms: PermissionView[], name: string): string[] {
  return ancestryOf(perms, name)
}

/** Permissions that may sign the change: the same list the main process accepts. */
function signOptions(perms: PermissionView[], intent: PermissionIntent, links: LinkedActionsView | null): string[] {
  return allowedSigners(perms, intent, links)
}

function helpOf(start: ChangeStart): HelpPlace {
  const kind = 'form' in start ? start.form : start.intent.kind
  switch (kind) {
    case 'setThreshold':
      return 'walletThreshold'
    case 'newPermission':
    case 'deletePermission':
      return 'walletNewPermission'
    case 'eosioCode':
      return 'walletEosioCode'
    case 'link':
    case 'unlink':
      return 'walletLinks'
    default:
      return 'walletPermissions'
  }
}

function titleOf(start: ChangeStart, account: string): string {
  if ('intent' in start) return 'Review the change'
  switch (start.form) {
    case 'addKey':
      return `Add key to ${account}@${start.permission}`
    case 'addAccount':
      return `Add account to ${account}@${start.permission}`
    case 'setThreshold':
      return `Set threshold of ${account}@${start.permission}`
    case 'newPermission':
      return `New permission of ${account}`
  }
}

/** Ids of an authority's entries (key, account, wait) with their weights, to find what a change adds or removes. */
function entryIds(auth: AuthorityView | null): Set<string> {
  if (!auth) return new Set()
  return new Set([
    ...auth.keys.map((k) => `k:${k.k1 || k.key}:${k.weight}`),
    ...auth.accounts.map((a) => `a:${a.actor}@${a.permission}:${a.weight}`),
    ...auth.waits.map((w) => `w:${w.waitSec}:${w.weight}`)
  ])
}

/**
 * One authority: threshold, keys, accounts and waits with their weights, one
 * entry per line. Keys are written as in the permission tree. `other` is the
 * authority on the other side of the change: an entry missing there is marked
 * ("new" after the change, "removed" now).
 */
export function AuthorityBox({
  title,
  auth,
  other,
  side,
  vaultKeys
}: {
  title: string
  auth: AuthorityView | null
  other: AuthorityView | null
  side: 'now' | 'after'
  vaultKeys: string[]
}): React.JSX.Element {
  const there = entryIds(other)
  const mark = (id: string): React.JSX.Element | null =>
    other && !there.has(id) ? side === 'after' ? <span className="badge info">new</span> : <span className="badge red">removed</span> : null
  return (
    <div className="auth-box">
      <div className="auth-box-title">{title}</div>
      {auth === null ? (
        <div className="hint">(none)</div>
      ) : (
        <>
          <div className="auth-line">
            Threshold {auth.threshold}
            {other && other.threshold !== auth.threshold && <span className="badge warn">{side === 'after' ? 'changed' : 'changes'}</span>}
          </div>
          {auth.keys.map((k) => (
            <div key={k.key} className="auth-line mono-small">
              <span className="badge">{k.weight}</span>
              <span className="auth-entry">{k.key}</span>
              {vaultKeys.includes(k.k1) && <span className="badge green">vault</span>}
              {mark(`k:${k.k1 || k.key}:${k.weight}`)}
            </div>
          ))}
          {auth.accounts.map((a) => (
            <div key={`${a.actor}@${a.permission}`} className="auth-line mono-small">
              <span className="badge">{a.weight}</span>
              <span className="auth-entry">
                {a.actor}@{a.permission}
              </span>
              {mark(`a:${a.actor}@${a.permission}:${a.weight}`)}
            </div>
          ))}
          {auth.waits.map((w) => (
            <div key={w.waitSec} className="auth-line mono-small">
              <span className="badge">{w.weight}</span>
              <span className="auth-entry">wait {w.waitSec} s</span>
              {mark(`w:${w.waitSec}:${w.weight}`)}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export function PermissionChangeDialog({
  ctx,
  start,
  onClose,
  onSent
}: {
  ctx: WalletContext
  start: ChangeStart
  onClose: () => void
  /** Called after the transaction was sent (the section reads its data again). */
  onSent?: () => void
}): React.JSX.Element {
  const { view } = ctx
  const account = view.name
  const vault = useVaultKeys()
  const vaultKeys = vault.map((k) => k.publicKey)
  // Form fields.
  const [key, setKey] = useState('')
  const [weight, setWeight] = useState('1')
  const [actor, setActor] = useState('')
  const [actorPermission, setActorPermission] = useState('active')
  const current = 'form' in start && start.form !== 'newPermission' ? view.permissions.find((p) => p.name === start.permission) : undefined
  const [threshold, setThreshold] = useState(String(current?.threshold ?? 1))
  const [newName, setNewName] = useState('')
  const [parent, setParent] = useState('form' in start && start.form === 'newPermission' ? start.parent : 'active')
  // Review.
  const [intent, setIntent] = useState<PermissionIntent | null>('intent' in start ? start.intent : null)
  const [signWith, setSignWith] = useState('')
  const [plan, setPlan] = useState<PermissionPlanView | null>(null)
  const [refusal, setRefusal] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState<FormLine | null>(null)
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  const [sent, setSent] = useState(false)

  const links = 'intent' in start ? (start.links ?? null) : null
  const options = intent ? signOptions(view.permissions, intent, links) : []
  // Default signer: the nearest listed permission the vault can sign with; owner only when nothing below it can.
  useEffect(() => {
    if (!intent) return
    const opts = signOptions(view.permissions, intent, links)
    setSignWith(defaultSigner(opts, (p) => view.control.includes(p)) || 'active')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  useEffect(() => {
    if (!intent || !signWith) return
    let live = true
    setLoading(true)
    setRefusal('')
    setPlan(null)
    setLine(null)
    window.wax.wallet.permPreview(intent, signWith).then(
      (p) => {
        if (!live) return
        setPlan(p)
        setLoading(false)
      },
      (e) => {
        if (!live) return
        setRefusal(errorText(e))
        setLoading(false)
      }
    )
    return () => {
      live = false
    }
  }, [intent, signWith])

  const weightNum = /^\d{1,5}$/.test(weight) ? Number(weight) : NaN
  const weightOk = weightNum >= 1 && weightNum <= 65535
  const thresholdNum = /^\d{1,5}$/.test(threshold) ? Number(threshold) : NaN
  const formIntent = (): PermissionIntent | null => {
    if (!('form' in start)) return null
    switch (start.form) {
      case 'addKey':
        return key && weightOk ? { kind: 'addKey', account, permission: start.permission, key, weight: weightNum } : null
      case 'addAccount':
        return NAME.test(actor) && NAME.test(actorPermission) && weightOk
          ? { kind: 'addAccount', account, permission: start.permission, actor, actorPermission, weight: weightNum }
          : null
      case 'setThreshold':
        return thresholdNum >= 1 && thresholdNum <= 65535 ? { kind: 'setThreshold', account, permission: start.permission, threshold: thresholdNum } : null
      case 'newPermission':
        return NAME.test(newName) && NAME.test(parent) && key ? { kind: 'newPermission', account, permission: newName, parent, key } : null
    }
  }
  const ready = formIntent()

  const send = async (): Promise<void> => {
    if (!intent || !plan) return
    setBusy(true)
    setLine(null)
    try {
      const r = await withVault(() => window.wax.wallet.permSend(intent, signWith, plan.basis))
      if (r.status === 'sent') {
        setTrace(r.trace)
        setSent(true)
        toast('Change sent', plan.title, 'success')
        // The account and the account lists of the pickers, at once, after 1.5 s and after 4 s.
        ctx.afterSend()
        onSent?.()
      } else {
        if (r.status === 'failed' && r.trace) setTrace(r.trace)
        setLine(outcomeLine(r, CANCELLED_NOT_SENT))
      }
    } catch (e) {
      setLine(isUnlockCancelled(e) ? { kind: 'note', text: CANCELLED_NOT_SENT } : { kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const editing = intent === null
  const total = current ? [...current.keys, ...current.accounts, ...current.waits].reduce((s, e) => s + e.weight, 0) : 0

  return (
    <Modal
      size="l"
      name="permission-change"
      help={helpOf(start)}
      title={plan && !editing ? plan.title : titleOf(start, account)}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {!editing && 'form' in start && !sent && (
            <button className="btn" disabled={busy} onClick={() => setIntent(null)}>
              Back
            </button>
          )}
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          {editing ? (
            <button className="btn primary" disabled={!ready} onClick={() => setIntent(ready)}>
              Review change
            </button>
          ) : (
            !sent && (
              <button className="btn primary" disabled={!plan || busy || loading || ctx.viewOnly} onClick={() => void send()}>
                {busy ? <Busy text="Waiting for confirmation..." /> : 'Send to confirmation'}
              </button>
            )
          )}
        </>
      }
    >
      {editing && 'form' in start && (
        <div className="wallet-form">
          {start.form === 'newPermission' && (
            <>
              <p className="wallet-lead">
                A permission of its own for one job (for example <span className="mono">claim</span>): it gets one key, and actions are linked to it in
                Linked actions. <HelpButton place="walletNewPermission" />
              </p>
              <div className="field">
                <label>Name of the new permission</label>
                <input className="input mono" value={newName} onChange={(e) => setNewName(e.target.value.trim().toLowerCase())} placeholder="claim" />
              </div>
              <div className="field">
                <label>Parent</label>
                <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
                  {view.permissions.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {(start.form === 'addKey' || start.form === 'newPermission') && (
            <div className="field">
              <label>{start.form === 'newPermission' ? 'Key of the new permission' : 'Key to add'}</label>
              <KeyPicker value={key} onChange={setKey} keys={vault} />
              <NoBackupLine publicKey={key} />
            </div>
          )}
          {start.form === 'addAccount' && (
            <div className="field-row">
              <div className="field">
                <label>Account</label>
                <AccountPicker mode="other" value={actor} onChange={setActor} />
              </div>
              <div className="field">
                <label>Its permission</label>
                <input className="input mono" value={actorPermission} onChange={(e) => setActorPermission(e.target.value.trim().toLowerCase())} />
              </div>
            </div>
          )}
          {(start.form === 'addKey' || start.form === 'addAccount') && (
            <div className="field">
              <label>Weight</label>
              <input className="input mono" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value.trim())} />
              <div className="hint">{addEntryWeightHint(start.permission, current?.threshold, weightNum)}</div>
            </div>
          )}
          {start.form === 'setThreshold' && (
            <div className="field">
              <label>
                Threshold <HelpButton place="walletThreshold" />
              </label>
              <input className="input mono" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.trim())} />
              <div className="hint">
                Now {current?.threshold ?? '?'}; the entries of {start.permission} add up to {total}. A threshold the signing keys and accounts cannot reach is refused.
              </div>
            </div>
          )}
        </div>
      )}
      {!editing && (
        <div className="wallet-form perm-review">
          {loading && <div className="hint">Reading {account} from the chain...</div>}
          {refusal && <div className="error-text">{refusal}</div>}
          {plan && (
            <>
              {plan.explanation.map((t) => (
                <p key={t} className="wallet-lead">
                  {t}
                </p>
              ))}
              {plan.warnings.map((t) => (
                <div key={t} className="banner warn">
                  {t}
                </div>
              ))}
              {(plan.before || plan.after) && (
                <div className="auth-compare">
                  <AuthorityBox title="Now" auth={plan.before} other={plan.after} side="now" vaultKeys={vaultKeys} />
                  <AuthorityBox title="After the change" auth={plan.after} other={plan.before} side="after" vaultKeys={vaultKeys} />
                </div>
              )}
            </>
          )}
          {options.length > 0 && (
            <div className="field">
              <label>Sign the change with permission</label>
              <select className="select" value={signWith} disabled={busy || sent} onChange={(e) => setSignWith(e.target.value)}>
                {options.map((p) => (
                  <option key={p} value={p}>
                    {p}
                    {view.control.includes(p) ? ' (vault can sign)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {ctx.viewOnly && <div className="acct-note">{ctx.reason}</div>}
          {plan && <CommandView action={plan.action} />}
          {line && <div className={formLineClass(line)}>{line.text}</div>}
          {trace && <InspectorBody t={trace} />}
        </div>
      )}
    </Modal>
  )
}
