import {
  ConfigStore, createConfigStore, createLocalStorageCache, installConfigRuntime,
} from '../sdk/config.ts'
import type {
  ConfigDocument, FabricConfigRecord, FabricConfigRuntime, FabricConfigRuntimeSnapshot,
  ConfigResourceTransport, FabricConfigSchema, FabricModRecord, FabricPageRecord, FabricThemeRecord, JsonRecord,
} from '../sdk/config.ts'
import type { Observable } from '../sdk/observable.ts'

export interface FabricConfigDefinition {
  id: string
  title: string
  owner?: string
  documentId?: string
  schema: FabricConfigSchema
  description?: string
  pluginId?: string
  order?: number
}

export interface FabricModDefinition {
  id: string
  name: string
  version?: string
  description?: string
  icon?: unknown
  order?: number
}

export interface FabricThemeDefinition {
  id: string
  pluginId?: string
  scope?: 'global' | 'workbench'
  priority?: number
}

export interface FabricNamespacedConfigTransport {
  read(owner: string, id: string, schema: FabricConfigSchema): Promise<ConfigDocument>
  write(owner: string, id: string, seq: number, values: JsonRecord, schema: FabricConfigSchema): Promise<ConfigDocument>
}

/** In-memory catalog of mods, schema-driven configs, and theme contributions. */
export class FabricConfigRegistry implements FabricConfigRuntime, Observable<FabricConfigRuntimeSnapshot> {
  private snapshot: FabricConfigRuntimeSnapshot = Object.freeze({
    configs: Object.freeze([]),
    mods: Object.freeze([]),
    themes: Object.freeze([]),
    pages: Object.freeze([]),
    revision: 0,
  })
  private readonly listeners = new Set<() => void>()
  private readonly stores = new Map<string, ConfigStore>()
  private readonly configRecords = new Map<string, FabricConfigRecord>()
  private readonly modRecords = new Map<string, FabricModRecord>()
  private readonly themeRecords = new Map<string, FabricThemeRecord>()
  private pages: readonly FabricPageRecord[] = Object.freeze([])

  constructor(private readonly transport: FabricNamespacedConfigTransport) {
    installConfigRuntime(this)
  }

  getSnapshot(): FabricConfigRuntimeSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getStore(id: string): ConfigStore | undefined {
    return this.stores.get(id)
  }

  requireStore(id: string): ConfigStore {
    const store = this.stores.get(id)
    if (store === undefined) throw new Error(`fabric config "${id}" is not registered`)
    return store
  }

  registerConfig(definition: FabricConfigDefinition): () => void {
    if (this.configRecords.has(definition.id)) {
      throw new Error(`fabric config "${definition.id}" is already registered`)
    }
    const record: FabricConfigRecord = Object.freeze({
      id: definition.id,
      title: definition.title,
      order: definition.order ?? 0,
      schema: definition.schema,
      ...(definition.description !== undefined ? { description: definition.description } : {}),
      ...(definition.pluginId !== undefined ? { pluginId: definition.pluginId } : {}),
    })
    const owner = definition.owner ?? definition.pluginId ?? 'fabric'
    const documentId = definition.documentId ?? definition.id
    const resource: ConfigResourceTransport = {
      read: (_id, schema) => this.transport.read(owner, documentId, schema),
      write: (_id, seq, values, schema) => this.transport.write(owner, documentId, seq, values, schema),
    }
    const store = createConfigStore({
      id: definition.id,
      schema: definition.schema,
      resource,
      cache: createLocalStorageCache(),
    })
    this.configRecords.set(definition.id, record)
    this.stores.set(definition.id, store)
    this.publish()
    void store.load()
    return () => {
      store.dispose()
      this.stores.delete(definition.id)
      this.configRecords.delete(definition.id)
      this.publish()
    }
  }

  registerMod(definition: FabricModDefinition): () => void {
    if (this.modRecords.has(definition.id)) {
      throw new Error(`fabric mod "${definition.id}" is already registered`)
    }
    this.modRecords.set(definition.id, Object.freeze({
      id: definition.id,
      name: definition.name,
      order: definition.order ?? 0,
      ...(definition.version !== undefined ? { version: definition.version } : {}),
      ...(definition.description !== undefined ? { description: definition.description } : {}),
      ...(definition.icon !== undefined ? { icon: definition.icon } : {}),
    }))
    this.publish()
    return () => {
      this.modRecords.delete(definition.id)
      this.publish()
    }
  }

  syncPages(pages: readonly FabricPageRecord[]): void {
    this.pages = Object.freeze(pages.map(page => Object.freeze({ ...page })))
    this.publish()
  }

  registerTheme(definition: FabricThemeDefinition): () => void {
    if (this.themeRecords.has(definition.id)) {
      throw new Error(`fabric theme "${definition.id}" is already registered`)
    }
    this.themeRecords.set(definition.id, Object.freeze({
      id: definition.id,
      scope: definition.scope ?? 'global',
      priority: definition.priority ?? 0,
      ...(definition.pluginId !== undefined ? { pluginId: definition.pluginId } : {}),
    }))
    this.publish()
    return () => {
      this.themeRecords.delete(definition.id)
      this.publish()
    }
  }

  dispose(): void {
    for (const store of this.stores.values()) store.dispose()
    this.stores.clear()
    this.configRecords.clear()
    this.modRecords.clear()
    this.themeRecords.clear()
    this.listeners.clear()
    installConfigRuntime(undefined)
    this.snapshot = Object.freeze({
      configs: Object.freeze([]),
      mods: Object.freeze([]),
      themes: Object.freeze([]),
      pages: Object.freeze([]),
      revision: this.snapshot.revision + 1,
    })
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      configs: Object.freeze(
        [...this.configRecords.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
      ),
      mods: Object.freeze(
        [...this.modRecords.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
      ),
      themes: Object.freeze(
        [...this.themeRecords.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id)),
      ),
      pages: this.pages,
      revision: this.snapshot.revision + 1,
    })
    for (const listener of [...this.listeners]) listener()
  }
}
