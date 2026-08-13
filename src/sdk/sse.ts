import { ObservableStore } from './observable.ts'

export type EventStreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface EventStreamSnapshot<T> {
  readonly status: EventStreamStatus
  readonly latest: T | undefined
  readonly error: Error | undefined
  readonly reconnectAttempt: number
  readonly revision: number
}

export interface EventSourceLike {
  close(): void
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface EventStreamOptions<T> {
  url: string | (() => string)
  event?: string
  parse?: (event: MessageEvent<string>) => T
  withCredentials?: boolean
  minRetryMs?: number
  maxRetryMs?: number
  createEventSource?: (url: string, init: EventSourceInit) => EventSourceLike
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function defaultParse<T>(event: MessageEvent<string>): T {
  return JSON.parse(event.data) as T
}

/** Observable browser EventSource wrapper with bounded exponential reconnect. */
export class EventStream<T> extends ObservableStore<EventStreamSnapshot<T>> {
  private snapshot: EventStreamSnapshot<T> = Object.freeze({
    status: 'idle',
    latest: undefined,
    error: undefined,
    reconnectAttempt: 0,
    revision: 0,
  })
  private source: EventSourceLike | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private running = false

  constructor(private readonly options: EventStreamOptions<T>) {
    super()
  }

  getSnapshot(): EventStreamSnapshot<T> {
    return this.snapshot
  }

  start(): () => void {
    if (!this.running) {
      this.running = true
      this.connect(0)
    }
    return () => { this.stop() }
  }

  stop(): void {
    if (!this.running && this.snapshot.status === 'closed') return
    this.running = false
    this.clearTransport()
    this.setSnapshot({ status: 'closed', error: undefined, reconnectAttempt: 0 })
  }

  clearLatest(): void {
    if (this.snapshot.latest === undefined) return
    this.setSnapshot({ latest: undefined })
  }

  dispose(): void {
    this.stop()
    this.clearSubscribers()
  }

  private connect(attempt: number): void {
    if (!this.running) return
    this.clearTransport()
    this.setSnapshot({ status: 'connecting', error: undefined, reconnectAttempt: attempt })
    const create = this.options.createEventSource ?? ((url: string, init: EventSourceInit) => new EventSource(url, init))
    let source: EventSourceLike
    try {
      const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url
      source = create(url, { withCredentials: this.options.withCredentials ?? false })
    } catch (error) {
      this.scheduleReconnect(attempt, asError(error))
      return
    }
    this.source = source
    const eventName = this.options.event ?? 'message'
    let opened = false
    const onOpen = (): void => {
      if (this.source !== source || !this.running) return
      opened = true
      this.setSnapshot({ status: 'open', error: undefined, reconnectAttempt: 0 })
    }
    const onMessage = (raw: Event): void => {
      if (this.source !== source || !this.running) return
      try {
        const event = raw as MessageEvent<string>
        const latest = (this.options.parse ?? defaultParse<T>)(event)
        this.setSnapshot({ status: 'open', latest, error: undefined, reconnectAttempt: 0 })
      } catch (error) {
        this.setSnapshot({ status: 'error', error: asError(error) })
      }
    }
    const onError = (): void => {
      if (this.source !== source || !this.running) return
      source.close()
      this.source = undefined
      this.scheduleReconnect(opened ? 0 : attempt, new Error('event stream disconnected'))
    }
    source.addEventListener('open', onOpen)
    source.addEventListener(eventName, onMessage)
    source.addEventListener('error', onError)
  }

  private scheduleReconnect(attempt: number, error: Error): void {
    if (!this.running) return
    const nextAttempt = attempt + 1
    const min = Math.max(0, this.options.minRetryMs ?? 500)
    const max = Math.max(min, this.options.maxRetryMs ?? 15_000)
    const delay = Math.min(max, min * 2 ** Math.max(0, nextAttempt - 1))
    this.setSnapshot({ status: 'error', error, reconnectAttempt: nextAttempt })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect(nextAttempt)
    }, delay)
  }

  private clearTransport(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.source?.close()
    this.source = undefined
  }

  private setSnapshot(patch: Partial<Omit<EventStreamSnapshot<T>, 'revision'>>): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    })
    this.publish()
  }
}

export function createEventStream<T>(options: EventStreamOptions<T>): EventStream<T> {
  return new EventStream(options)
}
