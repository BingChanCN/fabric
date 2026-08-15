import { ObservableStore } from './observable.ts'
import type { JsonValue } from './json.ts'

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

const CONFIG_FIELD_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u

export function parseConfigSchema(value: unknown): FabricConfigSchema {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('config schema must be an object')
  const schema: FabricConfigSchema = {}
  for (const [key, rawField] of Object.entries(value)) {
    if (!CONFIG_FIELD_ID.test(key) || rawField === null || typeof rawField !== 'object' || Array.isArray(rawField)) {
      throw new Error(`invalid config field "${key}"`)
    }
    const field = rawField as Record<string, unknown>
    if (typeof field.title !== 'string' || field.title.trim() === '') throw new Error(`config field "${key}" needs a title`)
    if (field.type === 'boolean') {
      if (field.default !== undefined && typeof field.default !== 'boolean') throw new Error(`config field "${key}" has an invalid default`)
      schema[key] = { type: 'boolean', title: field.title, ...(typeof field.description === 'string' ? { description: field.description } : {}), ...(field.default === undefined ? {} : { default: field.default }) }
    } else if (field.type === 'string' || field.type === 'textarea') {
      if (field.default !== undefined && typeof field.default !== 'string') throw new Error(`config field "${key}" has an invalid default`)
      schema[key] = { type: field.type, title: field.title, ...(typeof field.description === 'string' ? { description: field.description } : {}), ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}), ...(field.default === undefined ? {} : { default: field.default }) }
    } else if (field.type === 'number') {
      if (field.default !== undefined && (typeof field.default !== 'number' || !Number.isFinite(field.default))) throw new Error(`config field "${key}" has an invalid default`)
      if (field.min !== undefined && (typeof field.min !== 'number' || !Number.isFinite(field.min))) throw new Error(`config field "${key}" has an invalid minimum`)
      if (field.max !== undefined && (typeof field.max !== 'number' || !Number.isFinite(field.max))) throw new Error(`config field "${key}" has an invalid maximum`)
      if (field.step !== undefined && (typeof field.step !== 'number' || !Number.isFinite(field.step) || field.step <= 0)) throw new Error(`config field "${key}" has an invalid step`)
      schema[key] = { type: 'number', title: field.title, ...(typeof field.description === 'string' ? { description: field.description } : {}), ...(typeof field.min === 'number' ? { min: field.min } : {}), ...(typeof field.max === 'number' ? { max: field.max } : {}), ...(typeof field.step === 'number' ? { step: field.step } : {}), ...(field.default === undefined ? {} : { default: field.default }) }
    } else if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length === 0) throw new Error(`config field "${key}" needs options`)
      const options = field.options.map((rawOption, index) => {
        if (rawOption === null || typeof rawOption !== 'object' || Array.isArray(rawOption)) throw new Error(`config field "${key}" option ${index} is invalid`)
        const option = rawOption as Record<string, unknown>
        if (typeof option.label !== 'string' || typeof option.value !== 'string') throw new Error(`config field "${key}" option ${index} is invalid`)
        return { label: option.label, value: option.value }
      })
      if (field.default !== undefined && (typeof field.default !== 'string' || !options.some(option => option.value === field.default))) throw new Error(`config field "${key}" has an invalid default`)
      schema[key] = { type: 'select', title: field.title, options, ...(typeof field.description === 'string' ? { description: field.description } : {}), ...(field.default === undefined ? {} : { default: field.default }) }
    } else {
      throw new Error(`config field "${key}" has an invalid type`)
    }
  }
  return schema
}

export function validateConfigValues(schema: FabricConfigSchema, values: unknown): JsonRecord {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error('config values must be an object')
  const input = values as Record<string, unknown>
  const output = defaultsFromSchema(schema) as Record<string, JsonValue>
  for (const key of Object.keys(input)) {
    const field = schema[key]
    if (field === undefined) throw new Error(`unknown config field "${key}"`)
    const value = input[key]
    if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`config field "${key}" must be boolean`)
    if ((field.type === 'string' || field.type === 'textarea') && typeof value !== 'string') throw new Error(`config field "${key}" must be string`)
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) throw new Error(`config field "${key}" is outside its allowed range`)
    if (field.type === 'select' && (typeof value !== 'string' || !field.options.some(option => option.value === value))) throw new Error(`config field "${key}" has an invalid option`)
    output[key] = value as JsonValue
  }
  return output
}

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

export interface ConfigResourceTransport {
  read(id: string, schema: FabricConfigSchema): Promise<ConfigDocument>
  write(id: string, seq: number, values: JsonRecord, schema: FabricConfigSchema): Promise<ConfigDocument>
}

export interface ConfigStoreOptions<T extends JsonRecord> {
  id: string
  schema: FabricConfigSchema
  defaults?: T
  resource?: ConfigResourceTransport
  cache?: ConfigCache
  debounceMs?: number
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
  private readonly resource: ConfigResourceTransport | undefined
  private readonly cache: ConfigCache | undefined
  private readonly debounceMs: number
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
    this.resource = options.resource
    this.cache = options.cache
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
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
    if (this.resource === undefined) {
      this.setSnapshot({ status: 'ready' })
      return this.snapshot
    }
    const generation = ++this.generation
    this.setSnapshot({
      status: this.snapshot.status === 'ready' ? 'ready' : 'loading',
      error: undefined,
    })
    try {
      const document = await this.resource.read(this.id, this.schema)
      if (generation !== this.generation) return this.snapshot
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
    if (this.resource === undefined || this.dirtyKeys.size === 0) return
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  private async flush(): Promise<void> {
    if (this.resource === undefined || this.dirtyKeys.size === 0) return
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
          const document = await this.resource.write(this.id, sentSeq, sentValues, this.schema)
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
  if (error === null || typeof error !== 'object') return undefined
  const value = error as { code?: unknown; details?: unknown }
  if (value.code !== 'config-conflict') return undefined
  return parseDocument(id, value.details)
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
