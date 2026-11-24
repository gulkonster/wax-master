// A tiny event bus for commands that cross component boundaries.

type Listener = (payload?: unknown) => void
const listeners = new Map<string, Set<Listener>>()

export function on(event: string, fn: Listener): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(fn)
  return () => set!.delete(fn)
}

export function emit(event: string, payload?: unknown): void {
  listeners.get(event)?.forEach((fn) => fn(payload))
}
