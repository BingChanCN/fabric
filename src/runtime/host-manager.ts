import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { mountHostPlugin } from '../host/plugin.ts'
import type { FabricHostPluginDefinition } from '../host/plugin.ts'
import type { FabricInventory, FabricInventoryEntry } from './inventory.ts'
import { FabricPackageStore } from '../host/package-store.ts'

export type FabricRuntimeHostStatus = 'inactive' | 'starting' | 'active' | 'failed'

export interface FabricRuntimeHostState {
  readonly packageName: string
  readonly version?: string
  readonly status: FabricRuntimeHostStatus
  readonly error?: string
}

interface LiveHost {
  readonly version: string
  readonly source: string
  readonly fiber?: Fiber
}

interface RuntimeHostModule {
  readonly default?: FabricHostPluginDefinition
}

/** Host-side reconciler for installed Fabric Runtime Packages. */
export class FabricRuntimeHostManager {
  private readonly live = new Map<string, LiveHost>()
  private readonly states = new Map<string, FabricRuntimeHostState>()
  private readonly activationErrors = new Map<string, string>()
  private readonly clientRetractions = new Map<string, number>()
  private clientOverrides: Readonly<Record<string, FabricInventoryEntry>> = {}
  private hostGeneration = 0
  private queue: Promise<void> = Promise.resolve()
  private unsubscribe: (() => void) | undefined
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly store: FabricPackageStore,
  ) {}

  async start(): Promise<void> {
    await this.store.inventory.cleanStaging()
    await this.store.inventory.cleanOrphanedVersions()
    this.unsubscribe = this.store.inventory.subscribe(inventory => {
      this.enqueue(inventory)
    })
    await this.enqueueReconcile(() => this.store.inventory.read())
    await this.publishClientInventory()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.queue
    for (const [name, live] of [...this.live]) {
      await live.fiber?.dispose()
      this.live.delete(name)
      this.states.set(name, { packageName: name, status: 'inactive' })
    }
    this.clientOverrides = {}
    this.clientRetractions.clear()
  }

  snapshot(): readonly FabricRuntimeHostState[] {
    return [...this.states.values()].sort((left, right) => left.packageName.localeCompare(right.packageName))
  }

  state(packageName: string): FabricRuntimeHostState | undefined {
    return this.states.get(packageName)
  }

  activationError(packageName: string, version: string): string | undefined {
    return this.activationErrors.get(`${packageName}@${version}`)
  }

  async activateCandidate(
    name: string,
    candidate: Readonly<{ version: string; source: string }>,
    fallback?: FabricInventoryEntry,
    commit?: () => void,
  ): Promise<void> {
    const activation = this.queue.then(async () => {
      const inventory = await this.store.inventory.read()
      const previous = fallback ?? inventory.plugins[name]
      const current = this.live.get(name)
      if (current !== undefined) await this.stop(name, current)
      const desired: FabricInventoryEntry = {
        version: candidate.version,
        source: candidate.source,
        enabled: true,
        ...(previous === undefined ? {} : { previous: { version: previous.version, source: previous.source } }),
      }
      if (await this.startDesired(name, desired, inventory.revision + 1)) {
        commit?.()
        return
      }
      const failure = this.activationError(name, candidate.version) ?? `fabric package "${name}" Host activation failed`
      if (previous?.enabled === true) await this.startDesired(name, previous, inventory.revision)
      else this.states.set(name, { packageName: name, status: 'inactive' })
      throw new Error(failure)
    })
    this.queue = activation.then(() => undefined, () => undefined)
    await activation
  }

  async reconcileNow(): Promise<void> {
    await this.enqueueCurrent()
  }

  setClientOverrides(overrides: Readonly<Record<string, FabricInventoryEntry>>): void {
    this.clientOverrides = { ...overrides }
  }

  async beginClientRetraction(packageName: string): Promise<FabricInventory> {
    const count = this.clientRetractions.get(packageName) ?? 0
    this.clientRetractions.set(packageName, count + 1)
    try {
      return await this.publishClientInventory()
    } catch (error) {
      if (count === 0) this.clientRetractions.delete(packageName)
      else this.clientRetractions.set(packageName, count)
      throw error
    }
  }

  async endClientRetraction(packageName: string): Promise<FabricInventory> {
    const count = this.clientRetractions.get(packageName)
    if (count === undefined) return this.publishClientInventory()
    if (count <= 1) this.clientRetractions.delete(packageName)
    else this.clientRetractions.set(packageName, count - 1)
    try {
      return await this.publishClientInventory()
    } catch (error) {
      this.clientRetractions.set(packageName, count)
      throw error
    }
  }

  async publishClientInventory(): Promise<FabricInventory> {
    await this.queue
    const desired = await this.store.inventory.read()
    const effective = this.effectivePlugins(desired)
    const plugins: Record<string, FabricInventoryEntry> = {}
    for (const [name, entry] of Object.entries(effective)) {
      const state = this.states.get(name)
      plugins[name] = {
        ...entry,
        enabled: entry.enabled
          && !this.clientRetractions.has(name)
          && state?.status === 'active'
          && state.version === entry.version
          && this.live.get(name)?.source === entry.source,
      }
    }
    return this.store.inventory.publish(plugins)
  }

  private enqueue(inventory: FabricInventory): void {
    if (this.disposed) return
    void this.enqueueReconcile(async () => inventory)
  }

  private enqueueCurrent(): Promise<void> {
    return this.enqueueReconcile(() => this.store.inventory.read())
  }

  private enqueueReconcile(readInventory: () => Promise<FabricInventory>): Promise<void> {
    const reconciliation = this.queue.then(async () => this.reconcile(await readInventory()))
    this.queue = reconciliation.catch(error => {
      console.error('[fabric] Runtime Host reconcile failed:', error)
    })
    return reconciliation
  }

  private effectivePlugins(inventory: FabricInventory): Readonly<Record<string, FabricInventoryEntry>> {
    return { ...inventory.plugins, ...this.clientOverrides }
  }

  private async reconcile(inventory: FabricInventory): Promise<void> {
    if (this.disposed) return
    const effective = this.effectivePlugins(inventory)
    const names = new Set(Object.keys(effective))
    for (const name of this.live.keys()) names.add(name)
    for (const name of names) {
      const desired = effective[name]
      const current = this.live.get(name)
      if (desired?.enabled !== true) {
        if (current !== undefined) await this.stop(name, current)
        if (desired === undefined) this.states.delete(name)
        else this.states.set(name, { packageName: name, status: 'inactive' })
        continue
      }
      if (current?.version === desired.version && current.source === desired.source) {
        this.states.set(name, { packageName: name, version: current.version, status: 'active' })
        continue
      }
      if (current !== undefined) await this.stop(name, current)
      if (!await this.startDesired(name, desired, inventory.revision)) await this.restorePrevious(name, desired)
    }
  }

  private async startDesired(name: string, desired: FabricInventoryEntry, revision: number): Promise<boolean> {
    const activationKey = `${name}@${desired.version}`
    this.activationErrors.delete(activationKey)
    this.states.set(name, { packageName: name, version: desired.version, status: 'starting' })
    try {
      const manifest = await this.store.readManifest(name, desired.version, desired.source)
      if (manifest.fabric.host === undefined) {
        this.live.set(name, { version: desired.version, source: desired.source })
        this.states.set(name, { packageName: name, version: desired.version, status: 'active' })
        return true
      }
      const packageRoot = resolve(this.store.packageDirectory(name, desired.version, desired.source))
      const entry = resolve(packageRoot, manifest.fabric.host)
      if (relative(packageRoot, entry).startsWith('..')) throw new Error('host entry escapes package root')
      const imported = await import(pathToFileURL(entry).href)
      const definition = (imported as RuntimeHostModule).default
      if (definition === undefined || typeof definition.setup !== 'function') {
        throw new Error(`runtime package "${name}@${desired.version}" has no default Fabric Host definition`)
      }
      this.hostGeneration = Math.max(this.hostGeneration + 1, revision)
      const fiber = this.ctx.plugin(mountHostPlugin(name, desired.version, definition, {
        generation: `${this.hostGeneration}`,
      }))
      try {
        await fiber.await()
      } catch (error) {
        await fiber.dispose()
        throw error
      }
      this.live.set(name, { version: desired.version, source: desired.source, fiber })
      this.states.set(name, { packageName: name, version: desired.version, status: 'active' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.activationErrors.set(activationKey, message)
      this.states.set(name, { packageName: name, version: desired.version, status: 'failed', error: message })
      return false
    }
  }

  private async restorePrevious(name: string, failed: FabricInventoryEntry): Promise<void> {
    const previous = failed.previous
    if (previous === undefined) return
    const packagePath = this.store.inventory.packagePath(name, previous.version)
    try {
      await readFile(join(packagePath, 'package.json'))
    } catch {
      return
    }
    await this.store.inventory.update(current => {
      const entry = current.plugins[name]
      if (entry === undefined || entry.version !== failed.version) return current.plugins
      return {
        ...current.plugins,
        [name]: {
          ...previous,
          enabled: failed.enabled,
          previous: { version: failed.version, source: failed.source },
        },
      }
    })
  }

  private async stop(name: string, live: LiveHost): Promise<void> {
    if (this.live.get(name) !== live) return
    this.live.delete(name)
    await live.fiber?.dispose()
    this.states.set(name, { packageName: name, status: 'inactive' })
  }
}

/** Resolve the profile directory from the Loader's file URL anchor. */
export function profileRootFromContext(ctx: Context & { readonly baseUrl?: string }): string | undefined {
  if (ctx.baseUrl === undefined || !ctx.baseUrl.startsWith('file:')) return undefined
  return resolve(fileURLToPath(ctx.baseUrl))
}
