import type { Context } from '@deepseek-ai/cordis'

interface RuntimeModuleRecord {
  readonly styles: readonly string[]
}

interface RuntimeModules {
  readonly loadCache: Map<string, RuntimeModuleRecord>
  invalidate(id: string): void
}

interface RuntimeFiber {
  await(): Promise<void>
}

interface RuntimeEntry {
  readonly fiber?: RuntimeFiber
}

interface RuntimeLoader {
  create(options: { readonly name: string; readonly config?: unknown }): Promise<string>
  resolve(id: string): RuntimeEntry
  remove(id: string): Promise<void>
}

interface RuntimeFetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

interface RuntimeFetchInit {
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
}

type RuntimeFetch = (input: string, init?: RuntimeFetchInit) => Promise<RuntimeFetchResponse>
type RuntimeBundleLoader = (url: string) => Promise<void>

type RuntimeClientStatus = 'loading' | 'active' | 'failed'

export interface FabricRuntimeClientRecord {
  readonly packageName: string
  readonly version: string
  readonly generation?: string
  readonly status: RuntimeClientStatus
  readonly error?: string
}

export interface FabricRuntimeClientReconcilerOptions {
  readonly fetch?: RuntimeFetch
  readonly loadBundle?: RuntimeBundleLoader
  readonly createEventSource?: (url: string) => RuntimeEventSource
  readonly inventoryPath?: string
  readonly eventsPath?: string
  readonly statusPath?: string
}

interface RuntimeEventSource {
  onmessage: ((event: { readonly data: string }) => void) | null
  onerror: (() => void) | null
  close(): void
}

interface RuntimeInventoryEntry {
  readonly version: string
  readonly source: string
  readonly enabled: boolean
  readonly previous?: { readonly version: string; readonly source: string }
}

interface RuntimeInventorySnapshot {
  readonly format: 1
  readonly revision: number
  readonly plugins: Readonly<Record<string, RuntimeInventoryEntry>>
}

const FABRIC_RUNTIME_PACKAGE_PREFIX = '/fabric/runtime/packages'
const FABRIC_RUNTIME_INVENTORY_PATH = '/fabric/runtime/inventory'
const FABRIC_RUNTIME_INVENTORY_EVENTS_PATH = '/fabric/runtime/inventory/events'
const FABRIC_RUNTIME_CLIENT_STATUS_PATH = '/fabric/runtime/clients/status'

const defaultFetch: RuntimeFetch = (input, init) => fetch(input, init)

const defaultLoadBundle: RuntimeBundleLoader = url => new Promise((resolve, reject) => {
  if (typeof document === 'undefined') {
    reject(new Error('fabric runtime client requires a browser document'))
    return
  }
  const script = document.createElement('script')
  script.async = true
  script.src = url
  script.addEventListener('load', () => {
    script.remove()
    resolve()
  }, { once: true })
  script.addEventListener('error', () => {
    script.remove()
    reject(new Error(`fabric runtime client bundle failed to load: ${url}`))
  }, { once: true })
  document.head.append(script)
})

const defaultEventSource = (url: string): RuntimeEventSource => {
  if (typeof EventSource === 'undefined') throw new Error('EventSource is unavailable')
  return new EventSource(url) as unknown as RuntimeEventSource
}

function moduleIdOf(packageName: string): string {
  return `fabric-runtime/${encodeURIComponent(packageName)}`
}

function packagePathPart(value: string): string {
  return encodeURIComponent(value)
}

function parseInventory(value: unknown): RuntimeInventorySnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('fabric runtime inventory is not an object')
  const raw = value as Record<string, unknown>
  if (raw.format !== 1) throw new Error(`unsupported Fabric runtime inventory format "${String(raw.format)}"`)
  if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw new Error('fabric runtime inventory revision is invalid')
  }
  if (raw.plugins === null || typeof raw.plugins !== 'object' || Array.isArray(raw.plugins)) {
    throw new Error('fabric runtime inventory plugins is invalid')
  }
  const plugins: Record<string, RuntimeInventoryEntry> = {}
  for (const [name, value] of Object.entries(raw.plugins as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`fabric runtime inventory entry "${name}" is invalid`)
    const entry = value as Record<string, unknown>
    if (typeof entry.version !== 'string' || entry.version.trim() === ''
      || typeof entry.source !== 'string' || entry.source.trim() === ''
      || typeof entry.enabled !== 'boolean') {
      throw new Error(`fabric runtime inventory entry "${name}" is invalid`)
    }
    let previous: RuntimeInventoryEntry['previous']
    if (entry.previous !== undefined) {
      const rawPrevious = entry.previous
      if (rawPrevious === null || typeof rawPrevious !== 'object' || Array.isArray(rawPrevious)) {
        throw new Error(`fabric runtime inventory previous entry "${name}" is invalid`)
      }
      const item = rawPrevious as Record<string, unknown>
      if (typeof item.version !== 'string' || typeof item.source !== 'string') {
        throw new Error(`fabric runtime inventory previous entry "${name}" is invalid`)
      }
      previous = { version: item.version, source: item.source }
    }
    plugins[name] = { version: entry.version, source: entry.source, enabled: entry.enabled, ...(previous === undefined ? {} : { previous }) }
  }
  return { format: 1, revision: raw.revision, plugins }
}

/** Per-browser-tab desired-state reconciler for Fabric Runtime Packages. */
export class FabricRuntimeClientReconciler {
  private readonly clientId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`
  private readonly fetchSnapshot: RuntimeFetch
  private readonly loadBundle: RuntimeBundleLoader
  private readonly createEventSource: (url: string) => RuntimeEventSource
  private readonly inventoryPath: string
  private readonly eventsPath: string
  private readonly statusPath: string
  private readonly live = new Map<string, { version: string; source: string; generation: string; entryId: string }>()
  private readonly statuses = new Map<string, FabricRuntimeClientRecord>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly FabricRuntimeClientRecord[] = Object.freeze([])
  private inventory: RuntimeInventorySnapshot = { format: 1, revision: 0, plugins: {} }
  private pending: RuntimeInventorySnapshot | undefined
  private readonly idleWaiters: Array<() => void> = []
  private reconciling = false
  private source: RuntimeEventSource | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reportQueue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    options: FabricRuntimeClientReconcilerOptions = {},
  ) {
    this.fetchSnapshot = options.fetch ?? defaultFetch
    this.loadBundle = options.loadBundle ?? defaultLoadBundle
    this.createEventSource = options.createEventSource ?? defaultEventSource
    this.inventoryPath = options.inventoryPath ?? FABRIC_RUNTIME_INVENTORY_PATH
    this.eventsPath = options.eventsPath ?? FABRIC_RUNTIME_INVENTORY_EVENTS_PATH
    this.statusPath = options.statusPath ?? FABRIC_RUNTIME_CLIENT_STATUS_PATH
  }

  getSnapshot(): readonly FabricRuntimeClientRecord[] {
    return this.snapshot
  }

  getInventory(): RuntimeInventorySnapshot {
    return this.inventory
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async retry(packageName: string): Promise<void> {
    if (this.disposed) return
    const desired = this.inventory.plugins[packageName]
    if (desired?.enabled !== true) throw new Error(`runtime package "${packageName}" is not active in this tab`)
    if (this.live.has(packageName)) await this.unload(packageName, `${this.inventory.revision}`, desired.version)
    await this.load(packageName, desired.version, desired.source, this.inventory.revision)
  }

  async start(): Promise<void> {
    if (this.disposed) return
    await this.pull()
    this.connect()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.source?.close()
    this.source = undefined
    for (const [packageName] of this.live) await this.unload(packageName)
    this.statuses.clear()
    this.emit()
  }

  private async pull(): Promise<void> {
    try {
      const response = await this.fetchSnapshot(this.inventoryPath)
      if (!response.ok) throw new Error(`inventory request failed with HTTP ${response.status}`)
      await this.enqueue(parseInventory(await response.json()))
    } catch (error) {
      this.setStatus('__inventory__', {
        packageName: '__inventory__',
        version: '',
        status: 'failed',
        error: errorMessage(error),
      })
    }
  }

  private connect(): void {
    if (this.disposed || this.source !== undefined) return
    try {
      const separator = this.eventsPath.includes('?') ? '&' : '?'
      const source = this.createEventSource(`${this.eventsPath}${separator}clientId=${encodeURIComponent(this.clientId)}`)
      this.source = source
      source.onmessage = event => {
        try {
          void this.enqueue(parseInventory(JSON.parse(event.data) as unknown))
        } catch (error) {
          this.setStatus('__inventory__', {
            packageName: '__inventory__',
            version: '',
            status: 'failed',
            error: errorMessage(error),
          })
        }
      }
      source.onerror = () => {
        source.close()
        if (this.source === source) this.source = undefined
        this.scheduleReconnect()
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== undefined) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.pull().finally(() => this.connect())
    }, 1000)
  }

  private enqueue(snapshot: RuntimeInventorySnapshot): Promise<void> {
    this.pending = snapshot
    const idle = new Promise<void>(resolve => { this.idleWaiters.push(resolve) })
    if (this.reconciling) return idle
    this.reconciling = true
    void (async () => {
      try {
        while (this.pending !== undefined && !this.disposed) {
          const next = this.pending
          this.pending = undefined
          await this.reconcile(next)
        }
      } finally {
        this.reconciling = false
        const waiters = this.idleWaiters.splice(0)
        for (const resolve of waiters) resolve()
      }
    })()
    return idle
  }

  private async reconcile(snapshot: RuntimeInventorySnapshot): Promise<void> {
    this.inventory = snapshot
    const desired = snapshot.plugins
    const retracted = new Set<string>()
    for (const packageName of [...this.live.keys()]) {
      if (desired[packageName]?.enabled !== true) {
        await this.unload(packageName, `${snapshot.revision}`)
        retracted.add(packageName)
      }
    }
    for (const [packageName, entry] of Object.entries(desired)) {
      if (entry.enabled !== true) {
        if (!retracted.has(packageName)) await this.unload(packageName, `${snapshot.revision}`, entry.version)
        continue
      }
      const current = this.live.get(packageName)
      if (current?.version === entry.version && current.source === entry.source) continue
      if (current !== undefined) await this.unload(packageName, `${snapshot.revision}`)
      await this.load(packageName, entry.version, entry.source, snapshot.revision)
    }
    this.statuses.delete('__inventory__')
    this.emit()
  }

  private async load(packageName: string, version: string, source: string, revision: number): Promise<void> {
    const moduleId = moduleIdOf(packageName)
    const generation = `${revision}`
    this.setStatus(packageName, { packageName, version, generation, status: 'loading' })
    const url = `${FABRIC_RUNTIME_PACKAGE_PREFIX}/${packagePathPart(packageName)}/${packagePathPart(version)}/client.js?generation=${encodeURIComponent(generation)}`
    let createdEntryId: string | undefined
    try {
      const modules = this.ctx.get('modules') as unknown as RuntimeModules
      const loader = this.ctx.get('loader') as unknown as RuntimeLoader
      modules.invalidate(moduleId)
      await this.loadBundle(url)
      if (!this.isStillDesired(packageName, version, source, revision)) {
        this.removeModule(moduleId)
        return
      }
      createdEntryId = await loader.create({
        name: moduleId,
        config: { fabricRuntime: { generation, clientId: this.clientId } },
      })
      const entryId = createdEntryId
      const fiber = loader.resolve(entryId).fiber
      if (fiber === undefined) throw new Error(`runtime Client entry "${moduleId}" did not create a fiber`)
      await fiber.await()
      if (!this.isStillDesired(packageName, version, source, revision)) {
        await loader.remove(entryId)
        this.removeModule(moduleId)
        return
      }
      this.live.set(packageName, { version, source, generation, entryId })
      this.setStatus(packageName, { packageName, version, generation, status: 'active' })
    } catch (error) {
      this.setStatus(packageName, { packageName, version, generation, status: 'failed', error: errorMessage(error) })
      // A failed entry may have been created before activation rejected.
      if (createdEntryId !== undefined) {
        try {
          const loader = this.ctx.get('loader') as unknown as RuntimeLoader
          await loader.remove(createdEntryId)
        } catch {
          // The status is the actionable result; cleanup will be retried on the next reconcile.
        }
      }
      this.removeModule(moduleId)
    }
  }

  private isStillDesired(packageName: string, version: string, source: string, revision: number): boolean {
    if (this.disposed) return false
    const pending = this.pending
    if (pending === undefined || pending.revision <= revision) return true
    const desired = pending.plugins[packageName]
    return desired?.enabled === true && desired.version === version && desired.source === source
  }

  private async unload(packageName: string, generation?: string, desiredVersion?: string): Promise<void> {
    const record = this.live.get(packageName)
    const previous = this.statuses.get(packageName)
    if (record !== undefined) {
      this.live.delete(packageName)
      const moduleId = moduleIdOf(packageName)
      try {
        const loader = this.ctx.get('loader') as unknown as RuntimeLoader
        await loader.remove(record.entryId)
      } finally {
        this.removeModule(moduleId)
      }
    }
    this.statuses.delete(packageName)
    const version = desiredVersion ?? record?.version ?? previous?.version
    const reportGeneration = generation ?? record?.generation ?? previous?.generation
    if (version !== undefined && version !== '' && reportGeneration !== undefined) {
      await this.reportStatus({ packageName, version, generation: reportGeneration, status: 'inactive' })
    }
  }

  private removeModule(moduleId: string): void {
    const modules = this.ctx.get('modules') as unknown as RuntimeModules
    const styles = modules.loadCache.get(moduleId)?.styles ?? []
    if (typeof document !== 'undefined') {
      for (const element of [...document.querySelectorAll('style')]) {
        if (element.getAttribute('data-plugin') === moduleId || styles.includes(element.getAttribute('data-plugin-css') ?? '')) {
          element.remove()
        }
      }
    }
    modules.invalidate(moduleId)
  }

  private setStatus(packageName: string, status: FabricRuntimeClientRecord): void {
    this.statuses.set(packageName, status)
    if (packageName !== '__inventory__' && status.generation !== undefined) {
      void this.reportStatus({
        packageName,
        version: status.version,
        generation: status.generation,
        status: status.status,
        ...(status.error === undefined ? {} : { error: status.error }),
      }).catch(() => {})
    }
    this.emit()
  }

  private reportStatus(report: {
    readonly packageName: string
    readonly version: string
    readonly generation: string
    readonly status: RuntimeClientStatus | 'inactive'
    readonly error?: string
  }): Promise<void> {
    const task = this.reportQueue.then(async () => {
      const response = await this.fetchSnapshot(this.statusPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: this.clientId, ...report }),
      })
      if (!response.ok) throw new Error(`runtime client status report failed with HTTP ${response.status}`)
    })
    this.reportQueue = task.catch(() => {})
    return task
  }

  private emit(): void {
    this.snapshot = Object.freeze([...this.statuses.values()].sort((left, right) => left.packageName.localeCompare(right.packageName)))
    for (const listener of [...this.listeners]) listener()
  }
}

let installedRuntimeClient: FabricRuntimeClientReconciler | undefined

export function installFabricRuntimeClient(runtime: FabricRuntimeClientReconciler | undefined): void {
  installedRuntimeClient = runtime
}

export function getFabricRuntimeClient(): FabricRuntimeClientReconciler {
  if (installedRuntimeClient === undefined) throw new Error('Fabric Runtime Client is not installed')
  return installedRuntimeClient
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}