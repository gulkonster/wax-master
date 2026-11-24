// Keeps the window usable when a view fails to draw: instead of an empty
// window, a short panel with the error line and "Back to Home". The error is
// written to the main log. The panel goes away when `resetKey` changes (a
// new view was chosen) or when the user picks Back to Home.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { oneLine } from '../../../shared/window-error'
import { reportWindowError } from '../lib/window-errors'

interface Props {
  children: ReactNode
  /** Back to Home: the caller shows the Home page (and closes what it must). */
  onHome: () => void
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
    return (
      <div className="view-error" role="alert">
        <h2>{this.props.what ?? 'This view'} could not be shown</h2>
        <div className="hint">{this.state.error}</div>
        <div className="hint">The error was written to logs\main.log in the app data folder.</div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            this.setState({ error: null })
            this.props.onHome()
          }}
        >
          Back to Home
        </button>
      </div>
    )
  }
}
