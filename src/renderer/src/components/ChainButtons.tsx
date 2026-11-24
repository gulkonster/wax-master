// Contracts, Account and Network buttons on the right of the top bar.

import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state'
import { emit } from '../lib/bus'
import { networkStore, selectNetwork } from '../lib/networks'
import { Store, useStore } from '../lib/stores'
import { IconCheck, IconChevronDown, IconContract, IconGlobe, IconPencil, IconPlus, IconUser } from './Icons'

/** Name shown on the Contracts and Account buttons (last opened). */
export const lastOpened = new Store<{ account: string | null; contract: string | null }>({ account: null, contract: null })

function useOutside(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open, close])
  return ref
}

function ChainButton(props: {
  icon: React.ReactNode
  label: string
  value: string
  active: boolean
  onMain: () => void
  children: (close: () => void) => React.ReactNode
  mainnet?: boolean
  /** Chain names are shown in the monospace font. */
  mono?: boolean
  none?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div ref={ref} className={`tb-button right${props.active ? ' active' : ''}`}>
      <button className="tb-main" onClick={props.onMain}>
        {props.icon}
        <div>
          <div className="tb-label">{props.label}</div>
          <div className={`tb-value${props.none ? ' none' : props.mono ? ' mono' : ''}${props.mainnet ? ' mainnet-text' : ''}`}>{props.value}</div>
        </div>
      </button>
      <button className="tb-arrow" onClick={() => setOpen((o) => !o)}>
        <IconChevronDown />
      </button>
      {open && <div className="dropdown right">{props.children(() => setOpen(false))}</div>}
    </div>
  )
}

export function ChainButtons({ onAddNetwork, onManageNetworks, onStarred }: { onAddNetwork: () => void; onManageNetworks: () => void; onStarred: () => void }): React.JSX.Element {
  const { state, actions } = useApp()
  const net = useStore(networkStore)
  const last = useStore(lastOpened)

  const openAccount = (name: string): void => {
    lastOpened.set({ ...lastOpened.get(), account: name })
    actions.setView('account')
    setTimeout(() => emit('open-account', name), 0)
  }
  const openContract = (name: string): void => {
    lastOpened.set({ ...lastOpened.get(), contract: name })
    actions.setView('contract')
    setTimeout(() => emit('open-contract', name), 0)
  }

  const starredList = (pick: (name: string) => void, close: () => void): React.ReactNode => (
    <>
      <div className="dd-section">Starred</div>
      <div
        className="dd-item"
        onClick={() => {
          close()
          onStarred()
        }}
      >
        All Starred Accounts...
      </div>
      {net.stars.length === 0 && <div className="dd-note">No starred accounts on this network</div>}
      {net.stars.map((s) => (
        <div
          key={s}
          className="dd-item mono"
          onClick={() => {
            close()
            pick(s)
          }}
        >
          <IconUser /> {s}
        </div>
      ))}
    </>
  )

  const n = net.current
  return (
    <>
      <ChainButton
        icon={<IconContract size={18} />}
        label="Contracts"
        value={last.contract ?? '(none)'}
        mono
        none={!last.contract}
        active={state.view === 'contract'}
        onMain={() => (last.contract ? openContract(last.contract) : actions.setView('contract'))}
      >
        {(close) => starredList(openContract, close)}
      </ChainButton>
      <ChainButton
        icon={<IconUser size={18} />}
        label="Account"
        value={last.account ?? '(none)'}
        mono
        none={!last.account}
        active={state.view === 'account'}
        onMain={() => (last.account ? openAccount(last.account) : actions.setView('account'))}
      >
        {(close) => (
          <>
            <div
              className="dd-item"
              onClick={() => {
                close()
                emit('menu-command', 'create-account')
              }}
            >
              <IconPlus /> Create Account...
            </div>
            {starredList(openAccount, close)}
          </>
        )}
      </ChainButton>
      <ChainButton
        icon={n && !n.preset ? <IconPencil size={18} /> : <IconGlobe size={18} />}
        label="Network"
        value={n?.name ?? '(No Network)'}
        none={!n}
        mainnet={n?.kind === 'mainnet'}
        active={false}
        onMain={() => onManageNetworks()}
      >
        {(close) => (
          <>
            {net.list.map((x) => (
              <div
                key={x.id}
                className={`dd-item${x.id === n?.id ? ' selected' : ''}`}
                onClick={() => {
                  close()
                  if (x.id !== n?.id) void selectNetwork(x.id)
                }}
              >
                <span className="dd-lead">{x.id === n?.id && <IconCheck />}</span>
                {x.preset ? <IconGlobe /> : <IconPencil />} <span className={`dd-label${x.kind === 'mainnet' ? ' mainnet-text' : ''}`}>{x.name}</span>
              </div>
            ))}
            <div className="dd-sep" />
            <div
              className="dd-item"
              onClick={() => {
                close()
                onAddNetwork()
              }}
            >
              <IconPlus /> Add Network...
            </div>
            <div
              className="dd-item"
              onClick={() => {
                close()
                onManageNetworks()
              }}
            >
              <span className="dd-lead" />
              Manage Networks...
            </div>
          </>
        )}
      </ChainButton>
    </>
  )
}
