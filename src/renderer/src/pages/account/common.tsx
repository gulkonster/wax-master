// Shared pieces of the wallet sections: number formats, the resource gauge,
// the Command view of a form, and sending through the confirmation window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TxAction } from '../../../../shared/api'
import type { AccountView, PackResult } from '../../../../shared/chain-types'
import { isUnlockCancelled } from '../../../../shared/vault-locked'
import { copyText } from '../../lib/clipboard'
import { withVault } from '../../lib/vault'
import { errorText, toast } from '../../lib/toast'
import { IconCopy } from '../../components/Icons'
import { refreshPickLists } from '../../components/AccountPicker'
import { scheduleReadsAfterSend } from './wallet-form'

export const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

/** What every section gets: the account, whether the vault controls it, and a way to read it again. */
export interface WalletContext {
  view: AccountView
  /** True when the vault's keys reach no permission of the account. */
  viewOnly: boolean
  /** Shown next to every disabled signing button of a view-only account. */
  reason: string
  /** Reads the account (and the token list) again. */
  reload: () => void
  /** After a sent transaction: reads the account, the token list and the stakes at once, after 1.5 s and after 4 s. */
  afterSend: () => void
  /** Grows with each of those reads; a section that reads its own data (the stakes list) follows it. */
  readTick: number
}

/**
 * The reads after a sent transaction (`scheduleReadsAfterSend`); a new send
 * replaces the pending ones and leaving the page stops them. Each read also
 * drops the kept account lists of the pickers, so a changed permission shows
 * there with the right "vault" / "view only" mark.
 */
export function useReadsAfterSend(read: () => void, readLast: () => void): () => void {
  const fns = useRef({ read, readLast })
  fns.current = { read, readLast }
  const stop = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      stop.current?.()
      stop.current = null
    },
    []
  )
  return useCallback(() => {
    stop.current?.()
    stop.current = scheduleReadsAfterSend(
      (fn, ms) => setTimeout(fn, ms),
      (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      () => {
        refreshPickLists()
        fns.current.read()
      },
      () => fns.current.readLast()
    )
  }, [])
}

export function viewOnlyReason(name: string): string {
  return `View only: no key of ${name} is in the vault, so nothing can be signed for it here.`
}

export function fmtBytes(n: number): string {
  if (n < 0) return 'unlimited'
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

export function fmtUs(n: number): string {
  if (n < 0) return 'unlimited'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} s`
  if (n >= 1000) return `${(n / 1000).toFixed(2)} ms`
  return `${n} µs`
}

export function pct(used: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (used / max) * 100))
}

/** A chain time (UTC without a zone) or an ISO time, in the user's local form. */
export function fmtTime(t: string): string {
  if (!t) return ''
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`)
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString()
}

export function Gauge({ label, text, value }: { label: string; text: string; value: number }): React.JSX.Element {
  // Blue while there is room, yellow from 75 %, red from 90 %.
  const level = value >= 90 ? 'high' : value >= 75 ? 'warn' : undefined
  return (
    <div className="res-row">
      <div className="res-head">
        <span>{label}</span>
        <span className="res-value">{text}</span>
      </div>
      <div className="res-bar">
        <div className={level} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

/** The reason line under the buttons of a view-only account. */
export function ViewOnlyLine({ ctx }: { ctx: WalletContext }): React.JSX.Element | null {
  return ctx.viewOnly ? <div className="acct-note">{ctx.reason}</div> : null
}

/**
 * The Command view of a form: the action it will send as JSON, packed hex and
 * the cleos line, packed by the main process with the contract's ABI.
 */
export function CommandView({ action }: { action: TxAction | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pack, setPack] = useState<PackResult | null>(null)
  const [error, setError] = useState('')
  const key = action ? JSON.stringify(action) : ''

  useEffect(() => {
    setPack(null)
    setError('')
    if (!open || !action) return
    let live = true
    const t = setTimeout(() => {
      window.wax.contract
        .pack(action.account, action.name, action.data as Record<string, unknown>, action.authorization)
        .then(
          (p) => live && setPack(p),
          (e) => live && setError(errorText(e))
        )
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
    // The action is compared by its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text)
      toast('Copied', '', 'success')
    } catch (e) {
      toast('Copy failed', errorText(e), 'error')
    }
  }

  return (
    <div className="wallet-command">
      <button type="button" className={`btn subtle sm${open ? ' on' : ''}`} aria-pressed={open} onClick={() => setOpen((o) => !o)}>
        Command
      </button>
      {open &&
        (
          [
            ['JSON', pack?.json],
            ['Packed hex', pack?.hex],
            ['Cleos', pack?.cleos]
          ] as const
        ).map(([label, text]) => (
          <div key={label}>
            <div className="field-label">{label}</div>
            <div className="cmd-block">
              <pre>{text ?? (action ? (error ? `Could not pack: ${error}` : 'Packing...') : '(fill in the fields first)')}</pre>
              <button className="icon-btn" title="Copy" disabled={!text} onClick={() => text && void copy(text)}>
                <IconCopy />
              </button>
            </div>
          </div>
        ))}
    </div>
  )
}

export type SendMessage = { text: string; kind: 'good' | 'note' | 'error' } | null

/**
 * Sends actions through the normal path: the main process prepares them, the
 * confirmation window shows them, nothing is signed without the user's approval.
 * A locked vault is unlocked in place first. A cancel is a neutral note.
 * `afterSend` (the page's reads after a send) runs after every sent transaction.
 */
export function useSend(afterSend?: () => void): {
  busy: boolean
  message: SendMessage
  setMessage: (m: SendMessage) => void
  send: (actions: TxAction[], done: string, onSent?: () => void) => Promise<boolean>
} {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<SendMessage>(null)
  const send = async (actions: TxAction[], done: string, onSent?: () => void): Promise<boolean> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await withVault(() => window.wax.tx.run(actions))
      if (r.status === 'sent') {
        setMessage({ text: `${done} Transaction ${r.trace.id.slice(0, 12)}...`, kind: 'good' })
        toast(done, r.trace.id, 'success')
        onSent?.()
        afterSend?.()
        return true
      }
      if (r.status === 'failed') setMessage({ text: r.error, kind: 'error' })
      else setMessage({ text: 'Cancelled; nothing was sent.', kind: 'note' })
    } catch (e) {
      setMessage(isUnlockCancelled(e) ? { text: 'Cancelled; nothing was signed.', kind: 'note' } : { text: errorText(e), kind: 'error' })
    } finally {
      setBusy(false)
    }
    return false
  }
  return { busy, message, setMessage, send }
}

/** The switch of a section with more than one form ("Buy | Sell"): only the chosen form is drawn. */
export function FormSwitch<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="wallet-switch" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={o.id === value ? 'active' : undefined} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SendLine({ message }: { message: SendMessage }): React.JSX.Element | null {
  if (!message) return null
  return <div className={message.kind === 'error' ? 'error-text' : message.kind === 'note' ? 'hint' : 'acct-note good'}>{message.text}</div>
}

/** Existence of an account before a transfer or a stake: null when it exists, else the text that stops the form. */
export async function recipientProblem(name: string, network: string): Promise<string | null> {
  if (!NAME.test(name)) return 'Enter a valid account name.'
  try {
    return (await window.wax.chain.accountExists(name)) ? null : `This account does not exist on ${network}.`
  } catch (e) {
    return `Could not check ${name}: ${errorText(e)}`
  }
}
