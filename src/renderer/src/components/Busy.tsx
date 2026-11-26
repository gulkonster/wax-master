// Shows that a long piece of work is still running: a moving ring, what is
// being done and the time passed since it started.

import { useEffect, useState } from 'react'

/** Whole seconds as m:ss (0:07, 2:35). */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Milliseconds since `since` (or since the first render), updated every second. */
export function useElapsed(since?: number): number {
  const [mounted] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [since])
  return Math.max(0, now - (since ?? mounted))
}

export function Spinner(): React.JSX.Element {
  return <span className="spinner" aria-hidden="true" />
}

/** Button label while its work runs; the time passed appears after 3 s. */
export function Busy({ text }: { text: string }): React.JSX.Element {
  const ms = useElapsed()
  return (
    <>
      <Spinner />
      <span>{text}</span>
      {ms >= 3000 && <span className="busy-time">{elapsedText(ms)}</span>}
    </>
  )
}

/** A status line for a dialog: which step runs and for how long. */
export function WorkLine({ text, since }: { text: string; since: number }): React.JSX.Element {
  const ms = useElapsed(since)
  return (
    <div className="work-line" role="status">
      <Spinner />
      <span className="grow">{text}</span>
      <span className="busy-time" title="Time passed since this step started">
        {elapsedText(ms)}
      </span>
    </div>
  )
}
