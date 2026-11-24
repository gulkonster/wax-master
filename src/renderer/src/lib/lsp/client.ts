// A small JSON-RPC client for the editor engine. Messages go through the
// fixed `window.wax.editor.send` call; the main process converts addresses and
// relays them to the engine of the given session.

import type { monaco } from '../monaco'

export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type RequestHandler = (params: unknown) => unknown
type NotificationHandler = (params: unknown) => void

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

/** Request was cancelled by the server or by us (code -32800 / content modified -32801). */
export function isCancelled(err: unknown): boolean {
  return err instanceof RpcError && (err.code === -32800 || err.code === -32801)
}

export class LspClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private readonly requestHandlers = new Map<string, RequestHandler>()
  private readonly notificationHandlers = new Map<string, NotificationHandler>()
  private closed = false

  constructor(readonly session: number) {}

  get isClosed(): boolean {
    return this.closed
  }

  onRequest(method: string, fn: RequestHandler): void {
    this.requestHandlers.set(method, fn)
  }

  onNotification(method: string, fn: NotificationHandler): void {
    this.notificationHandlers.set(method, fn)
  }

  private post(msg: RpcMessage): Promise<void> {
    return window.wax.editor.send(this.session, msg as unknown as Record<string, unknown>)
  }

  request<T>(method: string, params: unknown, token?: monaco.CancellationToken): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(-32800, 'Editor engine stopped'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      const sub = token?.onCancellationRequested(() => {
        if (!this.pending.has(id)) return
        void this.post({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } }).catch(() => undefined)
      })
      const done = (): void => sub?.dispose()
      this.pending.set(id, {
        resolve: (v) => {
          done()
          resolve(v as T)
        },
        reject: (e) => {
          done()
          reject(e)
        }
      })
      this.post({ jsonrpc: '2.0', id, method, params }).catch((err) => {
        this.pending.delete(id)
        done()
        reject(err)
      })
    })
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return
    void this.post({ jsonrpc: '2.0', method, params }).catch(() => undefined)
  }

  /** Handles one message from the engine. */
  receive(msg: RpcMessage): void {
    if (this.closed) return
    if (msg.method !== undefined && msg.id !== undefined && msg.id !== null) {
      void this.answer(msg.id, msg.method, msg.params)
    } else if (msg.method !== undefined) {
      try {
        this.notificationHandlers.get(msg.method)?.(msg.params)
      } catch {
        // a bad notification must not stop the client
      }
    } else if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message))
      else p.resolve(msg.result ?? null)
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    const fn = this.requestHandlers.get(method)
    if (!fn) {
      await this.post({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unhandled method ${method}` } }).catch(() => undefined)
      return
    }
    try {
      const result = await fn(params)
      await this.post({ jsonrpc: '2.0', id, result: result ?? null })
    } catch (err) {
      await this.post({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }).catch(
        () => undefined
      )
    }
  }

  dispose(): void {
    this.closed = true
    for (const p of this.pending.values()) p.reject(new RpcError(-32800, 'Editor engine stopped'))
    this.pending.clear()
  }
}
