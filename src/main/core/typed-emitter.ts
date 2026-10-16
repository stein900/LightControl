/** Minimal strongly typed event emitter; `on` returns its own unsubscribe function. */
type Listener<Args extends unknown[]> = (...args: Args) => void

type ListenerMap<Events extends { [K in keyof Events]: unknown[] }> = {
  [K in keyof Events]?: Set<Listener<Events[K]>>
}

export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  private listeners: ListenerMap<Events> = {}

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set: Set<Listener<Events[K]>> = this.listeners[event] ?? new Set()
    this.listeners[event] = set
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners[event]
    if (!set) return
    for (const listener of [...set]) listener(...args)
  }

  removeAllListeners(): void {
    this.listeners = {}
  }
}
