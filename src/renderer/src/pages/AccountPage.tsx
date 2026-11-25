// The Account page: account tabs, the address bar (search, star, open as
// contract, keys) and, below, the wallet of the open account (pages/account).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MenuCommand } from '../../../shared/api'
import { on, emit } from '../lib/bus'
import { networkStore, toggleStar } from '../lib/networks'
import { useStore } from '../lib/stores'
import { lastOpened } from '../components/ChainButtons'
import { IconClose, IconContract, IconKey, IconPlus, IconRefresh, IconStar, IconUser } from '../components/Icons'
import { HelpButton } from '../components/HelpButton'
import { AccountBody } from './account/AccountBody'
import { NAME } from './account/common'
import { useApp } from '../state'

export function AccountPage(): React.JSX.Element {
  const { state, actions } = useApp()
  const net = useStore(networkStore)
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const open = useCallback((name: string) => {
    if (!NAME.test(name)) return
    setTabs((t) => (t.includes(name) ? t : [...t, name]))
    setActive(name)
    setInput(name)
    lastOpened.set({ ...lastOpened.get(), account: name })
  }, [])

  useEffect(() => on('open-account', (n) => open(n as string)), [open])

  // "Open as contract": the Contract page of this account, as the Contract section does.
  const openContract = (name: string): void => {
    actions.setView('contract')
    setTimeout(() => emit('open-contract', name), 0)
  }

  // Arrived from "Find an account": the search field has the focus, and once an account is
  // starred the page offers the way back to the dialog that asked.
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [back, setBack] = useState<null | { label: string; command: MenuCommand }>(null)
  useEffect(
    () =>
      on('account-search', (b) => {
        setBack((b as { label: string; command: MenuCommand } | undefined) ?? null)
        setActive(null)
        setInput('')
        setTimeout(() => searchRef.current?.focus(), 0)
      }),
    []
  )

  const close = (name: string): void => {
    const next = tabs.filter((t) => t !== name)
    setTabs(next)
    if (active === name) {
      setActive(next[next.length - 1] ?? null)
      setInput(next[next.length - 1] ?? '')
    }
  }

  // The active tab is scrolled into view when there are more tabs than fit.
  const tabBar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tabBar.current?.querySelector('.editor-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs, state.view])

  const starred = active ? net.stars.includes(active) : false

  return (
    <div className="chain-page">
      <div className="page-tabs" ref={tabBar}>
        {tabs.map((t) => (
          <div key={t} className={`editor-tab${t === active ? ' active' : ''}`} onClick={() => (setActive(t), setInput(t))}>
            {t}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                close(t)
              }}
            >
              <IconClose size="xs" />
            </span>
          </div>
        ))}
        <button className="icon-btn" title="New tab" onClick={() => (setActive(null), setInput(''))}>
          <IconPlus />
        </button>
      </div>
      <div className="address-bar">
        <button className="icon-btn" title="Refresh" onClick={() => active && emit('account-refresh', active)}>
          <IconRefresh />
        </button>
        <div className="address-input">
          <IconUser size="sm" />
          <input
            ref={searchRef}
            value={input}
            placeholder="Account name"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value.trim().toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && open(input)}
          />
          <button className={`icon-btn small${starred ? " on" : ""}`} disabled={!active} title={starred ? 'Unstar' : 'Star'} onClick={() => active && void toggleStar(active)}>
            <IconStar filled={starred} />
          </button>
        </div>
        <button className="icon-btn" title="Open as contract" disabled={!active} onClick={() => active && openContract(active)}>
          <IconContract />
        </button>
        <button className="icon-btn" title="Keys" disabled={!active} onClick={() => emit('open-keys', active)}>
          <IconKey />
        </button>
        <HelpButton place="accountPage" />
      </div>
      {back && active && starred && (
        <div className="banner green back-banner">
          <span className="grow">{active} is starred.</span>
          <button
            className="btn primary"
            onClick={() => {
              const cmd = back.command
              setBack(null)
              emit('menu-run', cmd)
            }}
          >
            Back to {back.label}
          </button>
          <button className="icon-btn" title="Close" onClick={() => setBack(null)}>
            <IconClose />
          </button>
        </div>
      )}
      {active && net.current ? (
        <AccountBody key={`${net.current.id}:${active}`} name={active} />
      ) : (
        <div className="coming">
          <div>Enter an account name and press Enter.</div>
        </div>
      )}
    </div>
  )
}

