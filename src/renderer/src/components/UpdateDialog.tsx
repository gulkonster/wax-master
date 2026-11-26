// A newer version is available: open the release page, or download, check and install it (E58).
// Nothing is downloaded or installed unless the user presses Download and install.

import { useEffect, useState } from 'react'
import type { UpdateDownload, UpdateProgress, UpdateResult } from '../../../shared/api'
import { Modal } from './Modal'
import { WorkLine } from './Busy'
import { emit } from '../lib/bus'
import { errorText } from '../lib/toast'
import { failureText, type SaveAllResult } from '../lib/save-result'

type Step =
  | { kind: 'offer' }
  | { kind: 'downloading'; since: number }
  | { kind: 'chain'; done: UpdateDownload }
  | { kind: 'installing'; done: UpdateDownload; since: number }
  | { kind: 'error'; text: string }

const MB = (n: number): string => (n / 1024 / 1024).toFixed(1)

/** The download line: percentage and megabytes, or only megabytes when GitHub gave no size. */
export function progressText(version: string, p: UpdateProgress | null): string {
  if (!p) return `Downloading WAX Master ${version}...`
  if (p.total > 0) {
    const pct = Math.min(100, Math.floor((p.received / p.total) * 100))
    return `Downloading WAX Master ${version}: ${pct}% (${MB(p.received)} of ${MB(p.total)} MB)`
  }
  return `Downloading WAX Master ${version}: ${MB(p.received)} MB`
}

const CHAIN_BUSY = new Set(['starting', 'running', 'stopping'])

/** Saves the open files that have changes; nothing to do when none has. A save that does not answer in 30 s counts as failed. */
export function saveChangedFiles(changed: number, timeoutMs = 30_000): Promise<SaveAllResult> {
  if (changed === 0) return Promise.resolve({ failed: [] })
  return new Promise<SaveAllResult>((resolve) => {
    const t = setTimeout(() => resolve({ failed: [{ title: 'Open files', error: 'the save did not finish within 30 s' }] }), timeoutMs)
    emit('save-all-then', (r: SaveAllResult) => {
      clearTimeout(t)
      resolve(r)
    })
  })
}

export function UpdateDialog({ update, changedFiles, onClose }: { update: UpdateResult; changedFiles: () => number; onClose: () => void }): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'offer' })
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  useEffect(() => window.wax.on('update-progress', (p: UpdateProgress) => setProgress(p)), [])

  const install = async (done: UpdateDownload): Promise<void> => {
    setStep({ kind: 'installing', done, since: Date.now() })
    // Open files are saved first; a file that cannot be saved stops the install.
    const saved = await saveChangedFiles(changedFiles())
    if (saved.failed.length) {
      setStep({ kind: 'error', text: `Not installed: some files could not be saved. ${failureText(saved.failed)}` })
      return
    }
    try {
      await window.wax.app.installUpdate()
    } catch (e) {
      setStep({ kind: 'error', text: errorText(e) })
    }
  }

  const afterDownload = async (done: UpdateDownload): Promise<void> => {
    const chain = await window.wax.localChain.status().catch(() => null)
    if (chain?.phase === 'setting-up') {
      setStep({ kind: 'error', text: `WAX Master ${done.version} is downloaded and checked, but the local chain is being set up. Wait until it is set up, then press Download and install again.` })
      return
    }
    if (chain && CHAIN_BUSY.has(chain.phase)) {
      setStep({ kind: 'chain', done })
      return
    }
    await install(done)
  }

  const download = async (): Promise<void> => {
    setProgress(null)
    setStep({ kind: 'downloading', since: Date.now() })
    try {
      await afterDownload(await window.wax.app.downloadUpdate())
    } catch (e) {
      setStep({ kind: 'error', text: errorText(e) })
    }
  }

  const busy = step.kind === 'downloading' || step.kind === 'installing'
  const version = update.latest ?? ''
  const releasePage = (
    <button
      className="btn"
      disabled={busy}
      onClick={() => {
        void window.wax.app.openExternal(update.url)
        onClose()
      }}
    >
      Open the release page
    </button>
  )

  return (
    <Modal
      size="m"
      name="update-available"
      help="updateAvailable"
      title="A new version is available"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {step.kind === 'downloading' ? (
            <button className="btn" onClick={() => void window.wax.app.cancelUpdateDownload()}>
              Cancel download
            </button>
          ) : (
            <button className="btn" disabled={busy} onClick={onClose}>
              {step.kind === 'chain' ? 'Cancel' : 'Later'}
            </button>
          )}
          {releasePage}
          {step.kind === 'chain' ? (
            <button className="btn primary" onClick={() => void install(step.done)}>
              Stop it and install
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void download()}>
              {step.kind === 'error' ? 'Try again' : 'Download and install'}
            </button>
          )}
        </>
      }
    >
      <p>
        WAX Master {version} is available (you have {update.current}). Download and install gets the installer of that release from GitHub, checks it against the
        release's SHA256SUMS.txt, saves your open files, closes WAX Master and starts the installer. Nothing is downloaded before you press it.
      </p>
      {step.kind === 'downloading' && <WorkLine text={progressText(version, progress)} since={step.since} />}
      {step.kind === 'chain' && (
        <div className="banner warn">
          WAX Master {step.done.version} is downloaded and checked (SHA-256 matches SHA256SUMS.txt). The local chain is running: WAX Master stops it before the
          installer starts, as at every close. Its accounts and contracts are kept; start it again after the update.
        </div>
      )}
      {step.kind === 'installing' && (
        <WorkLine text={`Checked (SHA-256 matches SHA256SUMS.txt). Saving open files and closing WAX Master; the installer of ${step.done.version} starts next...`} since={step.since} />
      )}
      {step.kind === 'error' && <div className="error-text">{step.text}</div>}
    </Modal>
  )
}
