import { ObservableStore } from './observable.ts'
import type { JsonClient, JsonValue } from './http.ts'

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

const CONFIG_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u
const DEFAULT_DEBOUNCE_MS = 200
const RUNTIME_KEY = '__fabricConfigRuntime__'

export function isConfigId(value: string): boolean {
  return CONFIG_ID.test(value)
}

export function defaultsFromSchema(schema: FabricConfigSchema): JsonRecord {
  const values: Record<string, JsonValue> = {}
  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) {
      values[key] = field.default as JsonValue
      continue
    }
    if (field.type === 'boolean') values[key] = false
    else if (field.type === 'number') values[key] = 0
    else if (field.type === 'select') values[key] = field.options[0]?.value ?? ''
    else values[key] = ''
  }
  return values
}

export function createLocalStorageCache(prefix = 'fabric:config:'): ConfigCache {
  return {
    read(id) {
      if (typeof localStorage === 'undefined') return undefined
      try {
        const raw = localStorage.getItem(prefix + id)
        if (raw === null || raw === '') return undefined
        const parsed = JSON.parse(raw) as Partial<ConfigDocument>
        if (parsed === null || typeof parsed !== 'object') return undefined
        if (parsed.id !== id || typeof parsed.seq !== 'number' || typeof parsed.values !== 'object' || parsed.values === null) {
          return undefined
        }
        return { id, seq: parsed.seq, values: parsed.values as JsonRecord }
      } catch {
        return undefined
      }
    },
    write(id, document) {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(prefix + id, JSON.stringify(document))
      } catch {
        /* quota / private mode */
      }
    },
    clear(id) {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.removeItem(prefix + id)
      } catch {
        /* ignore */
      }
    },
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDocument(id: string, payload: unknown): ConfigDocument | undefined {
  if (!isRecord(payload)) return undefined
  const seq = payload.seq
  const values = payload.values
  if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0 || !isRecord(values)) return undefined
  return { id, seq, values }
}

function sameValue(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Abortable, dirty-key-safe config store. Remote GETs never overwrite local edits. */
export class ConfigStore<T extends JsonRecord = JsonRecord> extends ObservableStore<ConfigSnapshot<T>> {
  readonly id: string
  readonly schema: FabricConfigSchema
  private readonly defaults: T
  private readonly client: Pick<JsonClient, 'get' | 'put'> | undefined
  private readonly cache: ConfigCache | undefined
  private readonly debounceMs: number
  private readonly endpoint: string
  private snapshot: ConfigSnapshot<T>
  private persisted: T
  private readonly dirtyKeys = new Set<string>()
  private persistTimer: ReturnType<typeof setTimeout> | undefined
  private persistInFlight = false
  private persistQueued = false
  private generation = 0

  constructor(options: ConfigStoreOptions<T>) {
    super()
    if (!isConfigId(options.id)) throw new Error(`fabric config id "${options.id}" is invalid`)
    this.id = options.id
    this.schema = options.schema
    this.defaults = {
      ...defaultsFromSchema(options.schema),
      ...(options.defaults ?? {}),
    } as T
    this.client = options.client
    this.cache = options.cache
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.endpoint = options.endpoint ?? '/fabric/config'
    const cached = this.cache?.read(this.id)
    const initialValues = {
      ...this.defaults,
      ...(cached?.id === this.id ? cached.values : {}),
    } as T
    this.persisted = initialValues
    this.snapshot = Object.freeze({
      status: 'idle',
      values: initialValues,
      dirty: false,
      error: undefined,
      seq: cached?.seq ?? 0,
      revision: 0,
    })
  }

  getSnapshot(): ConfigSnapshot<T> {
    return this.snapshot
  }

  set(patch: Partial<T>): void {
    const next = { ...this.snapshot.values } as Record<string, JsonValue>
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      if (!sameValue(next[key], value)) this.dirtyKeys.add(key)
      next[key] = value
    }
    this.setSnapshot({
      values: next as T,
      dirty: this.dirtyKeys.size > 0,
      error: undefined,
    })
    this.schedulePersist()
  }

  reset(): void {
    this.dirtyKeys.clear()
    this.setSnapshot({
      values: this.persisted,
      dirty: false,
      error: undefined,
    })
  }

  async load(): Promise<ConfigSnapshot<T>> {
    if (this.client === undefined) {
      this.setSnapshot({ status: 'ready' })
      return this.snapshot
    }
    const generation = ++this.generation
    this.setSnapshot({
      status: this.snapshot.status === 'ready' ? 'ready' : 'loading',
      error: undefined,
    })
    try {
      const payload = await this.client.get<unknown>(`${this.endpoint}/${this.id}`, { session: false })
      if (generation !== this.generation) return this.snapshot
      const document = parseDocument(this.id, payload) ?? { id: this.id, seq: 0, values: {} }
      this.applyRemote(document)
      this.setSnapshot({ status: 'ready', error: undefined })
    } catch (error) {
      if (generation !== this.generation) return this.snapshot
      this.setSnapshot({ status: 'error', error: asError(error) })
    }
    return this.snapshot
  }

  async persist(): Promise<ConfigSnapshot<T>> {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    await this.flush()
    return this.snapshot
  }

  dispose(): void {
    this.generation += 1
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = undefined
    this.dirtyKeys.clear()
    this.clearSubscribers()
  }

  private applyRemote(document: ConfigDocument): void {
    const merged = { ...this.defaults, ...document.values } as Record<string, JsonValue>
    for (const key of this.dirtyKeys) {
      merged[key] = this.snapshot.values[key] as JsonValue
    }
    const values = merged as T
    if (this.dirtyKeys.size === 0) this.persisted = values
    this.cache?.write(this.id, { id: this.id, seq: document.seq, values })
    this.setSnapshot({
      values,
      seq: document.seq,
      dirty: this.dirtyKeys.size > 0,
    })
  }

  private schedulePersist(): void {
    if (this.client === undefined || this.dirtyKeys.size === 0) return
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  private async flush(): Promise<void> {
    if (this.client === undefined || this.dirtyKeys.size === 0) return
    if (this.persistInFlight) {
      this.persistQueued = true
      return
    }
    this.persistInFlight = true
    this.setSnapshot({ status: 'saving', error: undefined })
    try {
      let attempts = 0
      while (this.dirtyKeys.size > 0) {
        if (++attempts > 8) {
          this.setSnapshot({ status: 'error', error: new Error('config persist exceeded retry limit') })
          return
        }
        const sentValues = this.snapshot.values
        const sentDirty = new Set(this.dirtyKeys)
        const sentSeq = this.snapshot.seq
        try {
          const payload = await this.client.put<unknown>(`${this.endpoint}/${this.id}`, {
            seq: sentSeq,
            values: sentValues,
          }, { session: false })
          const document = parseDocument(this.id, payload)
          if (document === undefined) throw new Error(`invalid config document from ${this.id}`)
          for (const key of sentDirty) {
            if (sameValue(this.snapshot.values[key] as JsonValue, sentValues[key] as JsonValue)) {
              this.dirtyKeys.delete(key)
            }
          }
          this.applyRemote(document)
        } catch (error) {
          const conflict = readConflict(error, this.id)
          if (conflict !== undefined) {
            this.applyRemote(conflict)
            continue
          }
          this.setSnapshot({ status: 'error', error: asError(error) })
          return
        }
      }
      this.setSnapshot({
        status: 'ready',
        dirty: this.dirtyKeys.size > 0,
        error: undefined,
      })
    } finally {
      this.persistInFlight = false
      if (this.persistQueued) {
        this.persistQueued = false
        if (this.dirtyKeys.size > 0) void this.flush()
      }
    }
  }

  private setSnapshot(patch: Partial<Omit<ConfigSnapshot<T>, 'revision'>>): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    })
    this.publish()
  }
}

function readConflict(error: unknown, id: string): ConfigDocument | undefined {
  if (error === null || typeof error !== 'object' || !('status' in error) || (error as { status?: unknown }).status !== 409) {
    return undefined
  }
  const details = 'details' in error ? (error as { details?: unknown }).details : undefined
  return parseDocument(id, details)
}

export function createConfigStore<T extends JsonRecord>(options: ConfigStoreOptions<T>): ConfigStore<T> {
  return new ConfigStore(options)
}

export interface FabricPageRecord {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly pluginId?: string
}

export interface FabricConfigRuntimeSnapshot {
  readonly configs: readonly FabricConfigRecord[]
  readonly mods: readonly FabricModRecord[]
  readonly themes: readonly FabricThemeRecord[]
  readonly pages: readonly FabricPageRecord[]
  readonly revision: number
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

export interface FabricConfigRuntime {
  getStore(id: string): ConfigStore | undefined
  requireStore(id: string): ConfigStore
  getSnapshot(): FabricConfigRuntimeSnapshot
  subscribe(listener: () => void): () => void
}

export function installConfigRuntime(runtime: FabricConfigRuntime | undefined): void {
  const target = globalThis as Record<string, unknown>
  if (runtime === undefined) {
    Reflect.deleteProperty(target, RUNTIME_KEY)
    return
  }
  target[RUNTIME_KEY] = runtime
}

export function getConfigRuntime(): FabricConfigRuntime {
  const runtime = (globalThis as Record<string, unknown>)[RUNTIME_KEY]
  if (runtime === undefined) throw new Error('fabric config runtime is not installed')
  return runtime as FabricConfigRuntime
}
