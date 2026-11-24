// Keeps the window usable when a part of it fails to draw: instead of an empty
// window, a short panel with the error line and "Back to Home". The error is
// written to the main log. The panel goes away when `resetKey` changes (a
// new view or topic was chosen) or when the user picks Back to Home.
//
// The last boundary around the whole window has nothing to go back to; its
// panel offers "Reload window" instead.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { oneLine } from '../../../shared/window-error'
import { reportWindowError } from '../lib/window-errors'

interface Props {
  children: ReactNode
  /** Back to Home: the caller shows the Home page (and closes what it must). */
  onHome?: () => void
  /** Reload window: given only to the boundary around the whole window, in place of Back to Home. */
  onReload?: () => void
  /** A change of this value (such as the view name) clears the panel. */
  resetKey?: string
  /** What failed, for the panel title. */
  what?: string
  /** Where a caught error goes; the main log by default. */
  report?: (error: unknown) => void
}

interface State {
  error: string | null
}

/** Said under the panel of the whole window: open files keep their changes only in the page that failed. */
export const RELOAD_LOSES_CHANGES = 'Reload window starts the window again. Changes in open files that were not saved are lost.'

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: oneLine(error instanceof Error ? error.message : String(error)) || 'Unknown error' }
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    ;(this.props.report ?? ((e: unknown) => reportWindowError('render', e)))(error)
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    const { onReload, onHome } = this.props
    return (
      <div className={`view-error${onReload ? ' window-error' : ''}`} role="alert">
        {onReload && <div className="window-error-drag" />}
        <h2>{this.props.what ?? 'This view'} could not be shown</h2>
        <div className="hint">{this.state.error}</div>
        <div className="hint">The error was written to logs\main.log in the app data folder.</div>
        {onReload ? (
          <>
            <div className="hint">{RELOAD_LOSES_CHANGES}</div>
            <button type="button" className="btn primary" onClick={onReload}>
              Reload window
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              this.setState({ error: null })
              onHome?.()
            }}
          >
            Back to Home
          </button>
        )}
      </div>
    )
  }
}
