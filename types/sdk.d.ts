/** Minimal immutable snapshot source used by Fabric utilities. */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]
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
export interface ConfigResourceTransport {
  read(id: string, schema: FabricConfigSchema): Promise<ConfigDocument>
  write(id: string, seq: number, values: JsonRecord, schema: FabricConfigSchema): Promise<ConfigDocument>
}

/** Schema-driven config store backed by the typed config Resource. */
export declare class ConfigStore<T extends JsonRecord = JsonRecord> implements Observable<ConfigSnapshot<T>> {
  readonly id: string
  readonly schema: FabricConfigSchema
  constructor(options: {
    id: string
    schema: FabricConfigSchema
    defaults?: T
    resource?: ConfigResourceTransport
    cache?: { read(id: string): ConfigDocument | undefined; write(id: string, document: ConfigDocument): void; clear(id: string): void }
    debounceMs?: number
  })
  getSnapshot(): ConfigSnapshot<T>
  subscribe(listener: () => void): () => void
  set(patch: Partial<T>): void
  reset(): void
  load(): Promise<ConfigSnapshot<T>>
  persist(): Promise<ConfigSnapshot<T>>
  dispose(): void
}

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

/** Typed event stream returned by Fabric Resource watch. */
export declare class EventStream<T> implements Observable<EventStreamSnapshot<T>> {
  getSnapshot(): EventStreamSnapshot<T>
  subscribe(listener: () => void): () => void
  start(): () => void
  stop(): void
  clearLatest(): void
  dispose(): void
}

export type FabricResourceScope = 'profile'
export interface FabricSessionRef { readonly id: string }
export interface FabricCodec<T> { parse(value: unknown): T }
export interface FabricResourceDefinition<Request, Response, Event = never> {
  readonly owner: string
  readonly id: string
  readonly version: string
  readonly scope: FabricResourceScope
  readonly request: FabricCodec<Request>
  readonly response: FabricCodec<Response>
  readonly event?: FabricCodec<Event>
}
export interface FabricResourceContext {
  readonly pluginId: string
  readonly resourceId: string
  readonly scope: FabricResourceScope
  readonly signal: AbortSignal
}
export type FabricResourceHandler<Request, Response> = (request: Request, context: FabricResourceContext) => Response | Promise<Response>
export type FabricResourceEmitter<Event> = (event: Event) => void
export type FabricResourceStreamHandler<Request, Event> = (request: Request, context: FabricResourceContext, emit: FabricResourceEmitter<Event>) => void | (() => void) | Promise<void | (() => void)>
export interface FabricResourceHandlers<Request, Response, Event = never> {
  readonly query?: FabricResourceHandler<Request, Response>
  readonly mutate?: FabricResourceHandler<Request, Response>
  readonly stream?: FabricResourceStreamHandler<Request, Event>
}
export interface FabricResourceClient {
  read<Request, Response>(resource: FabricResourceDefinition<Request, Response, never>, request: Request, options?: { readonly signal?: AbortSignal }): Promise<Response>
  mutate<Request, Response>(resource: FabricResourceDefinition<Request, Response, never>, request: Request, options?: { readonly signal?: AbortSignal }): Promise<Response>
  watch<Request, Event>(resource: FabricResourceDefinition<Request, unknown, Event> & { readonly event: FabricCodec<Event> }, request: Request, options?: { readonly signal?: AbortSignal }): EventStream<Event>
}
export type FabricResourceWatchSnapshot<Event> = EventStreamSnapshot<Event>
export declare class FabricResourceError extends Error {
  readonly code: string
  readonly details: unknown
  readonly retryable: boolean
}
export declare function defineCodec<T>(parse: (value: unknown) => T): FabricCodec<T>
export declare function defineResource<Request, Response, Event = never>(definition: FabricResourceDefinition<Request, Response, Event>): FabricResourceDefinition<Request, Response, Event>
export declare const jsonCodec: FabricCodec<unknown>
export declare const voidCodec: FabricCodec<void>
