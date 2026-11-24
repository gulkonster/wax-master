// Warning before a key without a backup is given control of an account (Create
// Account, Change key): on a mainnet network a blocking question, on test
// networks one yellow line under the key.

import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { errorText } from '../lib/toast'
import { networkStore, isMainnetLike } from '../lib/networks'
import { vaultStore } from '../lib/vault'
import { useStore } from '../lib/stores'
import type { VaultKeyEntry } from '../../../shared/api'

/** Vault keys among the given public keys whose only copy is the vault. */
async function keysWithoutBackup(publicKeys: string[]): Promise<VaultKeyEntry[]> {
  let list: VaultKeyEntry[] = []
  try {
    list = await window.wax.keys.list()
  } catch {
    return []
  }
  return list.filter((k) => k.backup === 'none' && publicKeys.includes(k.publicKey))
}

/** The yellow line on test networks (nothing on mainnet: the question comes before the confirmation). */
export function NoBackupLine({ publicKey }: { publicKey: string }): React.JSX.Element | null {
  const net = useStore(networkStore).current
  const vs = useStore(vaultStore)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let live = true
    if (!publicKey) setMissing(false)
    else void keysWithoutBackup([publicKey]).then((l) => live && setMissing(l.length > 0))
    return () => {
      live = false
    }
  }, [publicKey, vs.noBackup, vs.keys])
  if (!missing || isMainnetLike(net)) return null
  return <div className="hint warn-note">This key has no backup: it exists only in this vault.</div>
}

/**
 * gate(keys) resolves true when the operation may go on: no key lacks a backup,
 * the network is not mainnet, or the user chose "Continue without backup" or
 * backed every such key up. `element` renders the question while it is open.
 */
export function useNoBackupGate(): { gate: (publicKeys: string[]) => Promise<boolean>; element: React.JSX.Element | null } {
  const net = useStore(networkStore).current
  const [open, setOpen] = useState<{ keys: VaultKeyEntry[]; done: (go: boolean) => void } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const gate = useCallback(
    async (publicKeys: string[]): Promise<boolean> => {
      if (!isMainnetLike(net)) return true
      const missing = await keysWithoutBackup(publicKeys)
      if (missing.length === 0) return true
      return new Promise<boolean>((resolve) => {
        setError('')
        setOpen({
          keys: missing,
          done: (go) => {
            setOpen(null)
            resolve(go)
          }
        })
      })
    },
    [net]
  )

  const backUpNow = async (): Promise<void> => {
    if (!open) return
    setBusy(true)
    setError('')
    try {
      for (const k of open.keys) {
        if ((await window.wax.keys.backup(k.id)) !== 'saved') {
          setBusy(false)
          return
        }
      }
      setBusy(false)
      open.done(true)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const element = open ? (
    <Modal
      size="s"
      name="no-backup"
      help="keyBackup"
      title="This key has no backup"
      onClose={busy ? undefined : () => open.done(false)}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => open.done(true)}>
            Continue without backup
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void backUpNow()}>
            {busy ? 'Waiting for the backup window...' : 'Back up now'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        The private key {open.keys.length > 1 ? 'of these keys exists' : 'exists'} only in this vault. If the vault or its password is
        lost, the account on {net?.name ?? 'this network'} is lost with it.
      </p>
      {open.keys.map((k) => (
        <div key={k.id} className="mono-small" style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}>
          {k.label || 'unlabelled'}: {k.publicKey}
        </div>
      ))}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  ) : null

  return { gate, element }
}
