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

export type JsonRecord = { readonly [key: string]: JsonValue }
export type FabricConfigFieldType = 'boolean' | 'string' | 'number' | 'select' | 'textarea'

interface FabricConfigFieldBase {
  title: string
  description?: string
}
export interface FabricBooleanField extends FabricConfigFieldBase {
  type: 'boolean'
  default?: boolean
}
export interface FabricStringField extends FabricConfigFieldBase {
  type: 'string'
  default?: string
  placeholder?: string
}
export interface FabricNumberField extends FabricConfigFieldBase {
  type: 'number'
  default?: number
  min?: number
  max?: number
  step?: number
}
export interface FabricSelectOption {
  label: string
  value: string
}
export interface FabricSelectField extends FabricConfigFieldBase {
  type: 'select'
  options: readonly FabricSelectOption[]
  default?: string
}
export interface FabricTextareaField extends FabricConfigFieldBase {
  type: 'textarea'
  default?: string
  placeholder?: string
}
export type FabricConfigField =
  | FabricBooleanField
  | FabricStringField
  | FabricNumberField
  | FabricSelectField
  | FabricTextareaField
export type FabricConfigSchema = Record<string, FabricConfigField>

export type ConfigStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error'
export interface ConfigSnapshot<T extends JsonRecord = JsonRecord> {
  readonly status: ConfigStatus
  readonly values: T
  readonly dirty: boolean
  readonly error: Error | undefined
  readonly seq: number
  readonly revision: number
}
export interface ConfigDocument<T extends JsonRecord = JsonRecord> {
  readonly id: string
  readonly seq: number
  readonly values: T
}
export interface ConfigCache {
  read(id: string): ConfigDocument | undefined
  write(id: string, document: ConfigDocument): void
  clear(id: string): void
}
export interface ConfigStoreOptions<T extends JsonRecord> {
  id: string
  schema: FabricConfigSchema
  defaults?: T
  client?: Pick<JsonClient, 'get' | 'put'>
  cache?: ConfigCache
  debounceMs?: number
  endpoint?: string
}

export declare function isConfigId(value: string): boolean
export declare function defaultsFromSchema(schema: FabricConfigSchema): JsonRecord
export declare function createLocalStorageCache(prefix?: string): ConfigCache

export declare class ConfigStore<T extends JsonRecord = JsonRecord> implements Observable<ConfigSnapshot<T>> {
  readonly id: string
  readonly schema: FabricConfigSchema
  constructor(options: ConfigStoreOptions<T>)
  getSnapshot(): ConfigSnapshot<T>
  subscribe(listener: () => void): () => void
  set(patch: Partial<T>): void
  reset(): void
  load(): Promise<ConfigSnapshot<T>>
  persist(): Promise<ConfigSnapshot<T>>
  dispose(): void
}
export declare function createConfigStore<T extends JsonRecord>(options: ConfigStoreOptions<T>): ConfigStore<T>

export interface FabricPageRecord {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly pluginId?: string
}
export interface FabricConfigRecord {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly pluginId?: string
  readonly order: number
  readonly schema: FabricConfigSchema
}
export interface FabricModRecord {
  readonly id: string
  readonly name: string
  readonly version?: string
  readonly description?: string
  readonly icon?: unknown
  readonly order: number
}
export interface FabricThemeRecord {
  readonly id: string
  readonly pluginId?: string
  readonly scope: 'global' | 'workbench'
  readonly priority: number
}
export interface FabricConfigRuntimeSnapshot {
  readonly configs: readonly FabricConfigRecord[]
  readonly mods: readonly FabricModRecord[]
  readonly themes: readonly FabricThemeRecord[]
  readonly pages: readonly FabricPageRecord[]
  readonly revision: number
}
export interface FabricConfigRuntime {
  getStore(id: string): ConfigStore | undefined
  requireStore(id: string): ConfigStore
  getSnapshot(): FabricConfigRuntimeSnapshot
  subscribe(listener: () => void): () => void
}
export declare function installConfigRuntime(runtime: FabricConfigRuntime | undefined): void
export declare function getConfigRuntime(): FabricConfigRuntime

export type FabricResourceScope = 'profile' | 'session'
export interface FabricSessionRef { readonly id: string }
export interface FabricCodec<T> { parse(value: unknown): T }
export interface FabricResourceDefinition<Request, Response, Event = never> { readonly id: string; readonly version: string; readonly scope: FabricResourceScope; readonly request: FabricCodec<Request>; readonly response: FabricCodec<Response>; readonly event?: FabricCodec<Event> }
export interface FabricResourceContext { readonly pluginId: string; readonly resourceId: string; readonly scope: FabricResourceScope; readonly session: FabricSessionRef | undefined; readonly signal: AbortSignal }
export type FabricResourceHandler<Request, Response> = (request: Request, context: FabricResourceContext) => Response | Promise<Response>
export type FabricResourceEmitter<Event> = (event: Event) => void
export type FabricResourceStreamHandler<Request, Event> = (request: Request, context: FabricResourceContext, emit: FabricResourceEmitter<Event>) => void | (() => void) | Promise<void | (() => void)>
export interface FabricResourceHandlers<Request, Response, Event = never> { readonly query?: FabricResourceHandler<Request, Response>; readonly mutate?: FabricResourceHandler<Request, Response>; readonly stream?: FabricResourceStreamHandler<Request, Event> }
export interface FabricResourceClient { read<Request, Response>(resource: FabricResourceDefinition<Request, Response, never>, request: Request, options?: { readonly signal?: AbortSignal; readonly session?: FabricSessionRef }): Promise<Response>; mutate<Request, Response>(resource: FabricResourceDefinition<Request, Response, never>, request: Request, options?: { readonly signal?: AbortSignal; readonly session?: FabricSessionRef }): Promise<Response>; watch<Request, Event>(resource: FabricResourceDefinition<Request, unknown, Event> & { readonly event: FabricCodec<Event> }, request: Request, options?: unknown): unknown }
export class FabricResourceError extends Error { readonly code: string; readonly details: unknown; readonly retryable: boolean }
export declare function defineCodec<T>(parse: (value: unknown) => T): FabricCodec<T>
export declare function defineResource<Request, Response, Event = never>(definition: FabricResourceDefinition<Request, Response, Event>): FabricResourceDefinition<Request, Response, Event>
export declare const jsonCodec: FabricCodec<unknown>
export declare const voidCodec: FabricCodec<void>
