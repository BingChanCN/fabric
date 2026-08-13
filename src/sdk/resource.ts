import { ObservableStore } from './observable.ts'

export type AsyncResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Immutable state published by {@link AsyncResource}. */
export interface AsyncResourceSnapshot<T> {
  readonly status: AsyncResourceStatus
  readonly value: T | undefined
  readonly hasValue: boolean
  readonly error: Error | undefined
  readonly refreshing: boolean
  readonly revision: number
}

export type AsyncLoader<T> = (signal: AbortSignal) => Promise<T>

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** Abortable latest-request-wins loader with a useSyncExternalStore-compatible face. */
export class AsyncResource<T> extends ObservableStore<AsyncResourceSnapshot<T>> {
  private snapshot: AsyncResourceSnapshot<T> = Object.freeze({
    status: 'idle',
    value: undefined,
    hasValue: false,
    error: undefined,
    refreshing: false,
    revision: 0,
  })
  private active: { generation: number; controller: AbortController } | undefined
  private generation = 0

  constructor(private readonly loader: AsyncLoader<T>) {
    super()
  }

  getSnapshot(): AsyncResourceSnapshot<T> {
    return this.snapshot
  }

  /** Start or replace a load. The promise always resolves to the settled snapshot. */
  async load(): Promise<AsyncResourceSnapshot<T>> {
    this.active?.controller.abort()
    const generation = ++this.generation
    const controller = new AbortController()
    this.active = { generation, controller }
    this.setSnapshot({
      status: this.snapshot.hasValue ? 'ready' : 'loading',
      error: undefined,
      refreshing: this.snapshot.hasValue,
    })
    try {
      const value = await this.loader(controller.signal)
      if (!this.isCurrent(generation)) return this.snapshot
      this.active = undefined
      this.setSnapshot({ status: 'ready', value, hasValue: true, error: undefined, refreshing: false })
    } catch (error) {
      if (!this.isCurrent(generation)) return this.snapshot
      this.active = undefined
      if (controller.signal.aborted) {
        this.setSnapshot({
          status: this.snapshot.hasValue ? 'ready' : 'idle',
          error: undefined,
          refreshing: false,
        })
      } else {
        this.setSnapshot({ status: 'error', error: asError(error), refreshing: false })
      }
    }
    return this.snapshot
  }

  cancel(): void {
    if (this.active === undefined) return
    const active = this.active
    this.active = undefined
    active.controller.abort()
    this.generation += 1
    this.setSnapshot({
      status: this.snapshot.hasValue ? 'ready' : 'idle',
      error: undefined,
      refreshing: false,
    })
  }

  set(value: T): void {
    this.cancel()
    this.setSnapshot({ status: 'ready', value, hasValue: true, error: undefined, refreshing: false })
  }

  reset(): void {
    this.cancel()
    this.setSnapshot({
      status: 'idle',
      value: undefined,
      hasValue: false,
      error: undefined,
      refreshing: false,
    })
  }

  dispose(): void {
    this.cancel()
    this.clearSubscribers()
  }

  private isCurrent(generation: number): boolean {
    return this.active?.generation === generation
  }

  private setSnapshot(patch: Partial<Omit<AsyncResourceSnapshot<T>, 'revision'>>): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    })
    this.publish()
  }
}

export function createAsyncResource<T>(loader: AsyncLoader<T>): AsyncResource<T> {
  return new AsyncResource(loader)
}
