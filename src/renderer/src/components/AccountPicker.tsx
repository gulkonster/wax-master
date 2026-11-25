// One account field for every form, in three modes:
//   starred  the contract account of Deploy, Clear Contract Code and the Project
//            Settings: only starred accounts, nothing can be typed;
//   signer   who signs: the list plus a typed name, looked up when the field is left;
//   other    the other party (recipient, a `name` parameter): a text field that
//            offers the same list as suggestions.
// The list comes from the main process: starred accounts first, then accounts of
// the vault's keys, each marked "vault" when the vault can sign for it.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountPickEntry, AccountPickList } from '../../../shared/api'
import { networkStore, toggleStar } from '../lib/networks'
import { vaultStore } from '../lib/vault'
import { useStore } from '../lib/stores'
import { errorText } from '../lib/toast'
import { IconChevronDown, IconStar, IconUser } from './Icons'

export type AccountPickerMode = 'starred' | 'signer' | 'other'

export const ACCOUNT_NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

/** More entries than this: a filter box narrows the list. */
const FILTER_FROM = 8

// ---------------------------------------------------------------- list data

const cache = new Map<string, { key: string; list: Promise<AccountPickList> }>()

/** Grows each time the kept lists are dropped; every open picker reads its list again. */
let generation = 0
const listeners = new Set<() => void>()

/**
 * Drops the kept lists (every network) and makes every open picker read its
 * list again: called after a sent transaction, since a permission change on the
 * chain changes what the vault can sign.
 */
export function refreshPickLists(): void {
  generation++
  cache.clear()
  for (const l of [...listeners]) l()
}

/** A number that changes each time the kept lists are dropped (`refreshPickLists`). */
function usePickGeneration(): number {
  const [gen, setGen] = useState(generation)
  useEffect(() => {
    const l = (): void => setGen(generation)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return gen
}

/** The picker list for a network (default: the current one); refreshed when stars or vault keys change, or after a sent transaction. */
export function usePickList(networkId?: string): { list: AccountPickList | null; reload: () => void } {
  const nets = useStore(networkStore)
  const vault = useStore(vaultStore)
  const id = networkId ?? nets.current?.id ?? ''
  const gen = usePickGeneration()
  // Stars are known for the current network only; another network's list is read once per vault change.
  const key = `${id === nets.current?.id ? nets.stars.join(',') : ''}|${vault.keys}|${vault.exists}|${gen}`
  const [list, setList] = useState<AccountPickList | null>(null)
  const [tick, setTick] = useState(0)
  const seen = useRef(0)
  useEffect(() => {
    if (!id) return
    let live = true
    let entry = cache.get(id)
    if (!entry || entry.key !== key || tick !== seen.current) {
      seen.current = tick
      entry = { key, list: window.wax.accounts.pickList(id) }
      cache.set(id, entry)
    }
    const mine = entry
    mine.list.then(
      (l) => live && setList(l),
      () => {
        if (cache.get(id) === mine) cache.delete(id)
        if (live) setList({ networkId: id, entries: [], vaultChecked: false })
      }
    )
    return () => {
      live = false
    }
  }, [id, key, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { list, reload }
}

// ---------------------------------------------------------------- dropdown

function useOutside(open: boolean, close: () => void, refs: React.RefObject<HTMLElement | null>[]): void {
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (refs.every((r) => !r.current || !r.current.contains(e.target as Node))) close()
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open, close, refs])
}

/** Where the list opens: under the field, on the page (a dialog body does not clip it). */
function placeUnder(el: HTMLElement | null): React.CSSProperties | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  // The list stays clear of the title bar and the status bar with a small gap, so its
  // last row is never under the window's edge; it scrolls inside when longer.
  const css = getComputedStyle(document.documentElement)
  const px = (name: string): number => parseFloat(css.getPropertyValue(name)) || 0
  const gap = px('--sp-2')
  const below = Math.max(0, window.innerHeight - r.bottom - px('--statusbar') - gap)
  const above = Math.max(0, r.top - px('--titlebar') - gap)
  const style: React.CSSProperties = { left: r.left, width: r.width }
  if (below < above && below < window.innerHeight / 3) {
    style.top = 'auto'
    style.bottom = window.innerHeight - r.top
    style.maxHeight = above
  } else {
    style.top = r.bottom
    style.maxHeight = below
  }
  return style
}

function Mark({ e }: { e: AccountPickEntry }): React.JSX.Element {
  return e.signable.length > 0 ? (
    <span className="acct-mark vault" title={`The vault can sign for ${e.signable.join(', ')}`}>
      vault
    </span>
  ) : (
    <span className="acct-mark" title="The vault has no key for this account">
      view only
    </span>
  )
}

function ListMenu({
  entries,
  showVault,
  value,
  anchor,
  filter,
  setFilter,
  onPick,
  menuRef
}: {
  entries: AccountPickEntry[]
  showVault: boolean
  value: string
  anchor: HTMLElement | null
  filter: string | null
  setFilter: (v: string) => void
  onPick: (account: string) => void
  menuRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const f = (filter ?? '').trim().toLowerCase()
  const shown = f ? entries.filter((e) => e.account.includes(f)) : entries
  const starred = shown.filter((e) => e.starred)
  const fromVault = showVault ? shown.filter((e) => !e.starred) : []
  const row = (e: AccountPickEntry): React.JSX.Element => (
    <div
      key={e.account}
      className={`dd-item mono${e.account === value ? ' selected' : ''}`}
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={() => onPick(e.account)}
    >
      <IconUser size="sm" />
      <span className="dd-label">{e.account}</span>
      <Mark e={e} />
    </div>
  )
  return (
    <div ref={menuRef} className="dropdown acct-menu" style={placeUnder(anchor)}>
      {filter !== null && (
        <input
          className="input acct-filter"
          autoFocus
          placeholder="Filter"
          spellCheck={false}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {starred.length > 0 && <div className="dd-section">Starred</div>}
      {starred.map(row)}
      {fromVault.length > 0 && <div className="dd-section">Accounts of vault keys</div>}
      {fromVault.map(row)}
      {starred.length === 0 && fromVault.length === 0 && <div className="dd-note">No account matches</div>}
    </div>
  )
}

// ---------------------------------------------------------------- picker

export function AccountPicker({
  mode,
  value,
  onChange,
  networkId,
  onFind,
  placeholder,
  autoFocus,
  inputClass = 'input mono'
}: {
  mode: AccountPickerMode
  value: string
  onChange: (account: string) => void
  /** Default: the current network. */
  networkId?: string
  /** Starred mode with an empty list: "Find an account" (opens the Account page with its search focused). */
  onFind?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** Class of the text field (signer and other modes); the Contract page uses its compact field. */
  inputClass?: string
}): React.JSX.Element {
  const { list, reload } = usePickList(networkId)
  const nets = useStore(networkStore)
  const netName = (networkId ? nets.list.find((n) => n.id === networkId)?.name : nets.current?.name) ?? 'this network'
  const isCurrent = !networkId || networkId === nets.current?.id
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [lookup, setLookup] = useState<null | 'checking' | 'missing' | 'found' | { error: string }>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useOutside(open, close, [boxRef, menuRef])

  const all = list?.entries ?? []
  const entries = mode === 'starred' ? all.filter((e) => e.starred) : all

  // A typed name is looked up when the field is left (signer mode).
  const check = async (name: string): Promise<void> => {
    if (mode !== 'signer' || !ACCOUNT_NAME.test(name) || all.some((e) => e.account === name) || !isCurrent) {
      setLookup(null)
      return
    }
    setLookup('checking')
    try {
      setLookup((await window.wax.chain.accountExists(name)) ? 'found' : 'missing')
    } catch (e) {
      setLookup({ error: errorText(e) })
    }
  }

  const pick = (account: string): void => {
    onChange(account)
    setLookup(null)
    setOpen(false)
    setFilter('')
  }

  if (mode === 'starred') {
    if (list && entries.length === 0 && !value) {
      return (
        <div className="acct-empty">
          <span className="grow">Star an account first: find it on the Account page and press the star.</span>
          {onFind && isCurrent && (
            <button className="btn" onClick={onFind}>
              Find an account
            </button>
          )}
        </div>
      )
    }
    return (
      <div className="acct-pick" ref={boxRef}>
        <button
          type="button"
          className="select acct-pick-btn"
          autoFocus={autoFocus}
          disabled={!list}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <IconUser size="sm" />
          {/* The arrow is the one every .select draws; no second icon. */}
          <span className={`name${value ? '' : ' empty'}`}>{value || (list ? 'Choose a starred account' : 'Loading accounts...')}</span>
        </button>
        {open && (
          <ListMenu
            entries={entries}
            showVault={false}
            value={value}
            anchor={boxRef.current}
            filter={entries.length > FILTER_FROM ? filter : null}
            setFilter={setFilter}
            onPick={pick}
            menuRef={menuRef}
          />
        )}
      </div>
    )
  }

  const typed = value.trim()
  const suggestions = mode === 'other' && typed ? entries.filter((e) => e.account.startsWith(typed) && e.account !== typed) : entries
  return (
    <div>
      <div className="acct-pick" ref={boxRef}>
        <input
          className={inputClass}
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder ?? (mode === 'signer' ? 'account' : 'account name')}
          onChange={(e) => {
            onChange(e.target.value.trim().toLowerCase())
            setLookup(null)
            if (mode === 'other') setOpen(true)
          }}
          onFocus={() => mode === 'other' && setOpen(true)}
          onBlur={() => {
            void check(typed)
            if (mode === 'other') setTimeout(() => setOpen(false), 0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            } else if (e.key === 'ArrowDown') setOpen(true)
          }}
        />
        {mode === 'signer' && (
          <button type="button" className="icon-btn" title="Starred accounts and accounts of vault keys" onClick={() => setOpen((o) => !o)}>
            <IconChevronDown />
          </button>
        )}
        {open && suggestions.length > 0 && (
          <ListMenu
            entries={suggestions}
            showVault
            value={value}
            anchor={boxRef.current}
            filter={mode === 'signer' && suggestions.length > FILTER_FROM ? filter : null}
            setFilter={setFilter}
            onPick={pick}
            menuRef={menuRef}
          />
        )}
      </div>
      {lookup === 'checking' && <div className="acct-note">Looking up {typed}...</div>}
      {lookup === 'missing' && (
        <div className="acct-note bad">
          {typed} not found on {netName}.
        </div>
      )}
      {lookup === 'found' && (
        <div className="acct-note">
          {typed} exists on {netName}.
          {!nets.stars.includes(typed) && (
            <button
              className="btn subtle sm"
              onClick={() =>
                void toggleStar(typed).then(() => {
                  setLookup(null)
                  reload()
                })
              }
            >
              <IconStar size="sm" /> Star
            </button>
          )}
        </div>
      )}
      {lookup && typeof lookup === 'object' && <div className="acct-note">Could not look up {typed}: {lookup.error}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- permission

/** Default permission of an account: active, or the first one the vault can sign. */
export function defaultPermission(entry: AccountPickEntry | undefined, names: string[]): string {
  const signable = entry?.signable ?? []
  if (signable.length === 0 || signable.includes('active')) return names.length === 0 || names.includes('active') ? 'active' : names[0]
  return signable[0]
}

/**
 * The permission of an account (no typing): filled from the account's permissions on
 * the chain, those the vault can sign first. On a network that is not the current one
 * the chain is not read; the saved value, `active` and what the vault can sign are offered.
 */
export function PermissionPicker({
  account,
  value,
  onChange,
  networkId
}: {
  account: string
  value: string
  onChange: (permission: string) => void
  networkId?: string
}): React.JSX.Element {
  const { list } = usePickList(networkId)
  const nets = useStore(networkStore)
  const isCurrent = !networkId || networkId === nets.current?.id
  const entry = list?.entries.find((e) => e.account === account)
  const [names, setNames] = useState<string[] | null>(null)
  const valid = ACCOUNT_NAME.test(account)
  // A sent transaction may have added or removed a permission: read them again.
  const gen = usePickGeneration()
  const namesOf = useRef('')

  useEffect(() => {
    // A new account starts empty; a read again after a send keeps the names until the answer comes.
    if (namesOf.current !== account) setNames(null)
    namesOf.current = account
    if (!valid || !isCurrent) {
      setNames(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      window.wax.chain.account(account).then(
        (v) => live && setNames(v.permissions.map((p) => p.name)),
        () => live && setNames([])
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [account, valid, isCurrent, gen])

  const signable = entry?.signable ?? []
  const base = names && names.length > 0 ? names : [...new Set(['active', 'owner', ...signable])]
  const options = [...new Set([...signable.filter((p) => base.includes(p)), ...base, ...(value ? [value] : [])])]

  // A new account gets its default once its permissions are known.
  const lastAccount = useRef(account)
  useEffect(() => {
    if (lastAccount.current === account) return
    if (!valid || (isCurrent && names === null)) return
    lastAccount.current = account
    const d = defaultPermission(entry, names ?? [])
    if (d !== value) onChange(d)
  }, [account, valid, isCurrent, names, entry, value, onChange])

  // No account chosen yet: a neutral placeholder, not a permission with a "view only" mark.
  if (!valid) {
    return (
      <select className="select" disabled value="" title="Choose the account first">
        <option value="">(account first)</option>
      </select>
    )
  }

  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((p) => (
        <option key={p} value={p}>
          {p}
          {signable.includes(p) ? ' (vault)' : list ? ' (view only)' : ''}
        </option>
      ))}
    </select>
  )
}
