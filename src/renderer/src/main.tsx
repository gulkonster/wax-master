import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installWindowErrorReports } from './lib/window-errors'

/** The last way out of a window that failed to draw: unsaved changes are gone with the page, so nothing is left to ask about on close. */
function reloadWindow(): void {
  void window.wax.app
    .setDirty(0)
    .catch(() => undefined)
    .finally(() => location.reload())
}

installWindowErrorReports()
// A fault outside the view area (a dialog, the title bar, the top bar, the bottom panel, App itself) shows a panel instead of an empty window.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary what="The window" onReload={reloadWindow}>
    <App />
  </ErrorBoundary>
)
