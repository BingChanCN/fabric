/** Minimal immutable snapshot source shared by Fabric's framework-neutral utilities. */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Small publisher base for utilities that expose stable snapshots. */
export abstract class ObservableStore<T> implements Observable<T> {
  private readonly listeners = new Set<() => void>()

  abstract getSnapshot(): T

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  protected publish(): void {
    for (const listener of [...this.listeners]) listener()
  }

  protected clearSubscribers(): void {
    this.listeners.clear()
  }
}
