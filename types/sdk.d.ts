/** Minimal immutable snapshot source used by Fabric utilities. */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export interface FabricHttpErrorOptions {
  status: number
  statusText: string
  url: string
  code?: string
  details?: unknown
}

export declare class FabricHttpError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string
  readonly code: string | undefined
  readonly details: unknown
  constructor(message: string, options: FabricHttpErrorOptions)
}

export interface JsonClientOptions {
  baseUrl?: string
  sessionId?: () => string | undefined
  sessionParam?: string
  headers?: HeadersInit | (() => HeadersInit)
  fetch?: typeof globalThis.fetch
}

export interface JsonRequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | JsonValue | undefined
  /** Skip automatic session query injection for a global endpoint. */
  session?: boolean
}

export interface JsonClient {
  request<T>(path: string, options?: JsonRequestOptions): Promise<T>
  get<T>(path: string, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  post<T>(path: string, body?: JsonValue, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  put<T>(path: string, body?: JsonValue, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  patch<T>(path: string, body?: JsonValue, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  delete<T>(path: string, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  url(path: string, options?: { session?: boolean }): string
}

export declare function createJsonClient(options?: JsonClientOptions): JsonClient

export type AsyncResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AsyncResourceSnapshot<T> {
  readonly status: AsyncResourceStatus
  readonly value: T | undefined
  readonly hasValue: boolean
  readonly error: Error | undefined
  readonly refreshing: boolean
  readonly revision: number
}

export type AsyncLoader<T> = (signal: AbortSignal) => Promise<T>

/** Abortable latest-request-wins loader. */
export declare class AsyncResource<T> implements Observable<AsyncResourceSnapshot<T>> {
  constructor(loader: AsyncLoader<T>)
  getSnapshot(): AsyncResourceSnapshot<T>
  subscribe(listener: () => void): () => void
  load(): Promise<AsyncResourceSnapshot<T>>
  cancel(): void
  set(value: T): void
  reset(): void
  dispose(): void
}

export declare function createAsyncResource<T>(loader: AsyncLoader<T>): AsyncResource<T>

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

/** Browser EventSource wrapper with bounded exponential reconnect. */
export declare class EventStream<T> implements Observable<EventStreamSnapshot<T>> {
  constructor(options: EventStreamOptions<T>)
  getSnapshot(): EventStreamSnapshot<T>
  subscribe(listener: () => void): () => void
  start(): () => void
  stop(): void
  clearLatest(): void
  dispose(): void
}

export declare function createEventStream<T>(options: EventStreamOptions<T>): EventStream<T>
