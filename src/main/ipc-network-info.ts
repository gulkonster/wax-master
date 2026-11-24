// IPC handlers of the Network page: read-only chain state of a saved network.

import type { BrowserWindow } from 'electron'
import { str } from '../shared/validate'
import { handle } from './ipc'
import * as networks from './networks'
import { readHead, readOverview } from './network-info'

export function registerNetworkInfoIpc(getWindow: () => BrowserWindow | null): void {
  handle('networkInfo:overview', (_e, id) => {
    const n = networks.getNetwork(str(id, 'id', 64))
    return readOverview(n.id, n.symbol, (fn) => networks.readCall(fn, n))
  })
  // The 2-second loop of the page; nothing is read while the window is minimized.
  handle('networkInfo:head', (_e, id) => {
    const n = networks.getNetwork(str(id, 'id', 64))
    if (getWindow()?.isMinimized()) return null
    return readHead(n.id, (fn) => networks.readCall(fn, n))
  })
}
