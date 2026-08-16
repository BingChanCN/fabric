import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import {
  extractFabricPackageArchive, resolveFabricPackageSource,
  type FabricPackageFetcher, type FabricResolvedPackageSource,
} from './package-source.ts'
import {
  assertRuntimeBundlePurity, isFabricPackageName, runtimeModuleId, validateFabricRuntimePackageManifest,
  type FabricRuntimePackageManifest,
} from '../runtime/manifest.ts'
import {
  emptyFabricInventory, parseFabricInventory, FABRIC_INVENTORY_FORMAT, type FabricInventory,
  type FabricInventoryEntry,
} from '../runtime/inventory.ts'
import type { FabricRuntimeClientRegistry } from './runtime-clients.ts'

export const FABRIC_RUNTIME_PACKAGE_PREFIX = '/fabric/runtime/packages'
export const FABRIC_RUNTIME_INVENTORY_PATH = '/fabric/runtime/inventory'
export const FABRIC_RUNTIME_INVENTORY_EVENTS_PATH = '/fabric/runtime/inventory/events'

export function encodeFabricPackageName(name: string): string {
  return encodeURIComponent(name)
}

export class FabricInventoryStore {
  readonly root: string
  readonly pluginsFile: string
  readonly packagesRoot: string
  readonly stagingRoot: string
  private ready: Promise<void> | undefined
  private writeQueue: Promise<void> = Promise.resolve()
  private published: FabricInventory = emptyFabricInventory()
  private readonly listeners = new Set<(inventory: FabricInventory) => void>()
  private readonly publishedListeners = new Set<(inventory: FabricInventory) => void>()

  constructor(profileRoot: string) {
    this.root = join(resolve(profileRoot), '.fabric')
    this.pluginsFile = join(this.root, 'plugins.json')
    this.packagesRoot = join(this.root, 'packages')
    this.stagingRoot = join(this.root, 'staging')
  }

  async read(): Promise<FabricInventory> {
    await this.ensureRoots()
    try {
      return parseFabricInventory(JSON.parse(await readFile(this.pluginsFile, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFabricInventory()
      throw error
    }
  }

  subscribe(listener: (inventory: FabricInventory) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readPublished(): FabricInventory {
    return this.published
  }

  subscribePublished(listener: (inventory: FabricInventory) => void): () => void {
    this.publishedListeners.add(listener)
    return () => { this.publishedListeners.delete(listener) }
  }

  publish(plugins: FabricInventory['plugins']): FabricInventory {
    this.published = parseFabricInventory({
      format: FABRIC_INVENTORY_FORMAT,
      revision: this.published.revision + 1,
      plugins,
    })
    for (const listener of [...this.publishedListeners]) listener(this.published)
    return this.published
  }

  async update(mutator: (current: FabricInventory) => FabricInventory['plugins']): Promise<FabricInventory> {
    let result!: FabricInventory
    const operation = this.writeQueue.then(async () => {
      const current = await this.read()
      const plugins = mutator(current)
      result = parseFabricInventory({
        format: FABRIC_INVENTORY_FORMAT,
        revision: current.revision + 1,
        plugins,
      })
      await this.writeAtomic(result)
      for (const listener of [...this.listeners]) listener(result)
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    await operation
    return result
  }

  packagePath(name: string, version: string): string {
    return join(this.packagesRoot, encodeFabricPackageName(name), version)
  }

  stagingPath(operationId: string = randomUUID()): string {
    return join(this.stagingRoot, operationId)
  }

  dataPath(name: string): string {
    if (!isFabricPackageName(name)) throw new Error(`fabric package name "${name}" is invalid`)
    return join(this.root, 'data', encodeFabricPackageName(name))
  }

  async cleanStaging(): Promise<void> {
    await this.ensureRoots()
    for (const name of await readdir(this.stagingRoot)) await rm(join(this.stagingRoot, name), { recursive: true, force: true })
  }

  async cleanOrphanedVersions(): Promise<void> {
    await this.ensureRoots()
    const inventory = await this.read()
    for (const packageEntry of await readdir(this.packagesRoot, { withFileTypes: true })) {
      const packagePath = join(this.packagesRoot, packageEntry.name)
      let packageName: string | undefined
      try {
        packageName = decodeURIComponent(packageEntry.name)
      } catch {
        // An unparseable directory cannot be referenced by plugins.json.
      }
      const desired = packageName === undefined ? undefined : inventory.plugins[packageName]
      const retained = new Set([
        ...(desired === undefined ? [] : [desired.version]),
        ...(desired?.previous === undefined ? [] : [desired.previous.version]),
      ])
      if (!packageEntry.isDirectory()) {
        await rm(packagePath, { recursive: true, force: true })
        continue
      }
      for (const version of await readdir(packagePath)) {
        if (!retained.has(version)) await rm(join(packagePath, version), { recursive: true, force: true })
      }
      if ((await readdir(packagePath)).length === 0) await rm(packagePath, { recursive: true, force: true })
    }
  }

  private async writeAtomic(inventory: FabricInventory): Promise<void> {
    await this.ensureRoots()
    const temporary = `${this.pluginsFile}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
    await rename(temporary, this.pluginsFile)
  }

  private ensureRoots(): Promise<void> {
    this.ready ??= mkdir(this.packagesRoot, { recursive: true })
      .then(() => mkdir(this.stagingRoot, { recursive: true }))
      .then(() => undefined)
    return this.ready
  }
}

export interface InstalledFabricPackage {
  readonly manifest: FabricRuntimePackageManifest
  readonly directory: string
  readonly source: string
  readonly reused: boolean
}

interface TransientFabricPackage {
  readonly manifest: FabricRuntimePackageManifest
  readonly directory: string
}

const EXCLUDED_PACKAGE_DIRECTORIES = new Set(['node_modules', '.git', '.fabric'])

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('Operation aborted', 'AbortError')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function copyTree(source: string, destination: string, root = source): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true })
  await mkdir(destination, { recursive: true })
  for (const item of entries) {
    if (item.isDirectory() && EXCLUDED_PACKAGE_DIRECTORIES.has(item.name)) continue
    const sourcePath = join(source, item.name)
    const destinationPath = join(destination, item.name)
    const relativePath = relative(root, sourcePath)
    const stats = await lstat(sourcePath)
    if (stats.isSymbolicLink() || item.isSymbolicLink()) throw new Error(`package contains unsupported symlink "${relativePath}"`)
    if (stats.isDirectory()) {
      await copyTree(sourcePath, destinationPath, root)
      continue
    }
    if (!stats.isFile()) throw new Error(`package contains unsupported file "${relativePath}"`)
    if (item.name.endsWith('.node')) throw new Error(`package contains unsupported native addon "${relativePath}"`)
    if (item.name === 'cordis.patch.yml' || item.name === 'cordis.patch.yaml') {
      throw new Error(`package contains unsupported legacy DSH manifest "${relativePath}"`)
    }
    await copyFile(sourcePath, destinationPath)
  }
}

async function validatePackageTree(directory: string, root = directory): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    const relativePath = relative(root, path)
    const stats = await lstat(path)
    if (stats.isSymbolicLink() || item.isSymbolicLink()) throw new Error(`package contains unsupported symlink "${relativePath}"`)
    if (stats.isDirectory()) {
      await validatePackageTree(path, root)
      continue
    }
    if (!stats.isFile()) throw new Error(`package contains unsupported file "${relativePath}"`)
    if (item.name.endsWith('.node')) throw new Error(`package contains unsupported native addon "${relativePath}"`)
    if (item.name === 'cordis.patch.yml' || item.name === 'cordis.patch.yaml') {
      throw new Error(`package contains unsupported legacy DSH manifest "${relativePath}"`)
    }
  }
}

async function validateInstalledTree(directory: string, manifest: FabricRuntimePackageManifest): Promise<void> {
  const checkEntry = async (entry: string | undefined, kind: 'host' | 'client' | 'contracts'): Promise<void> => {
    if (entry === undefined) return
    const path = resolve(directory, entry)
    if (relative(directory, path).startsWith('..') || resolve(path) !== path) throw new Error(`${kind} entry escapes package root`)
    const stats = await lstat(path)
    if (!stats.isFile()) throw new Error(`${kind} entry "${entry}" is not a file`)
    assertRuntimeBundlePurity(kind, await readFile(path, 'utf8'), kind === 'client'
      ? { moduleId: runtimeModuleId(manifest.name) }
      : {})
  }
  await checkEntry(manifest.fabric.host, 'host')
  await checkEntry(manifest.fabric.client, 'client')
  await checkEntry(manifest.fabric.contracts, 'contracts')
}

/** Immutable Runtime Package snapshots admitted through one validator. */
export class FabricPackageStore {
  private readonly transientPackages = new Map<string, TransientFabricPackage>()
  private readonly devRoot: string

  constructor(readonly inventory: FabricInventoryStore) {
    this.devRoot = join(inventory.root, 'dev')
  }

  resolveSource(
    source: string,
    options: { readonly signal?: AbortSignal; readonly fetcher?: FabricPackageFetcher } = {},
  ): Promise<FabricResolvedPackageSource> {
    return resolveFabricPackageSource(source, options)
  }

  async installResolved(
    resolved: FabricResolvedPackageSource,
    options: {
      readonly fabricApiVersion?: string
      readonly signal?: AbortSignal
      readonly fetcher?: FabricPackageFetcher
      readonly onStage?: (stage: 'downloading' | 'validating' | 'staging') => void
    } = {},
  ): Promise<InstalledFabricPackage> {
    const operationStaging = this.inventory.stagingPath()
    const packageStaging = join(operationStaging, 'package')
    try {
      await mkdir(operationStaging, { recursive: true })
      if (resolved.kind === 'directory') {
        if (resolved.directory === undefined) throw new Error('resolved directory source has no path')
        const stats = await lstat(resolved.directory)
        if (!stats.isDirectory()) throw new Error(`Runtime Package source "${resolved.directory}" is not a directory`)
        options.onStage?.('staging')
        await copyTree(resolved.directory, packageStaging)
      } else {
        options.onStage?.('downloading')
        await mkdir(packageStaging, { recursive: true })
        options.onStage?.('validating')
        await extractFabricPackageArchive(resolved, join(operationStaging, 'package.tgz'), packageStaging, options)
      }
      throwIfAborted(options.signal)
      options.onStage?.('validating')
      await validatePackageTree(packageStaging)
      const rootEntries = await readdir(packageStaging)
      if (rootEntries.some(name => name === 'cordis.patch.yml' || name === 'cordis.patch.yaml')) {
        throw new Error('Runtime Package contains unsupported cordis.patch manifest')
      }
      const raw = JSON.parse(await readFile(join(packageStaging, 'package.json'), 'utf8')) as unknown
      const manifest = validateFabricRuntimePackageManifest(raw, {
        ...(options.fabricApiVersion === undefined ? {} : { fabricApiVersion: options.fabricApiVersion }),
        ...(resolved.expectedName === undefined ? {} : { expectedName: resolved.expectedName }),
        ...(resolved.expectedVersion === undefined ? {} : { expectedVersion: resolved.expectedVersion }),
      })
      await validateInstalledTree(packageStaging, manifest)
      throwIfAborted(options.signal)
      const destination = this.inventory.packagePath(manifest.name, manifest.version)
      await mkdir(join(this.inventory.packagesRoot, encodeFabricPackageName(manifest.name)), { recursive: true })
      if (await pathExists(destination)) {
        await rm(operationStaging, { recursive: true, force: true })
        return { manifest, directory: destination, source: resolved.source, reused: true }
      }
      await rename(packageStaging, destination)
      await rm(operationStaging, { recursive: true, force: true })
      return { manifest, directory: destination, source: resolved.source, reused: false }
    } catch (error) {
      await rm(operationStaging, { recursive: true, force: true })
      throw error
    }
  }

  async installDirectory(source: string, options: { readonly fabricApiVersion?: string } = {}): Promise<InstalledFabricPackage> {
    const resolved = await this.resolveSource(source)
    if (resolved.kind !== 'directory') throw new Error(`Runtime Package source "${source}" is not a directory`)
    return this.installResolved(resolved, options)
  }

  async admitDevDirectory(
    source: string,
    leaseId: string,
    generation: number,
    options: { readonly fabricApiVersion?: string } = {},
  ): Promise<InstalledFabricPackage> {
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(leaseId) || !Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('Fabric dev lease or generation is invalid')
    }
    const resolvedSource = resolve(source)
    const stats = await lstat(resolvedSource)
    if (!stats.isDirectory()) throw new Error(`Runtime Package source "${source}" is not a directory`)
    const operationStaging = this.inventory.stagingPath()
    const packageStaging = join(operationStaging, 'package')
    const token = `${leaseId}.${generation}`
    const transientSource = `dev:${token}`
    try {
      await mkdir(operationStaging, { recursive: true })
      await copyTree(resolvedSource, packageStaging)
      await validatePackageTree(packageStaging)
      const raw = JSON.parse(await readFile(join(packageStaging, 'package.json'), 'utf8')) as unknown
      const manifest = validateFabricRuntimePackageManifest(raw, {
        ...(options.fabricApiVersion === undefined ? {} : { fabricApiVersion: options.fabricApiVersion }),
      })
      await validateInstalledTree(packageStaging, manifest)
      const destination = join(this.devRoot, encodeFabricPackageName(manifest.name), token)
      await mkdir(join(this.devRoot, encodeFabricPackageName(manifest.name)), { recursive: true })
      if (this.transientPackages.has(transientSource) || await pathExists(destination)) {
        throw new Error(`Fabric dev generation "${token}" is already admitted`)
      }
      await rename(packageStaging, destination)
      await rm(operationStaging, { recursive: true, force: true })
      this.transientPackages.set(transientSource, { manifest, directory: destination })
      return { manifest, directory: destination, source: transientSource, reused: false }
    } catch (error) {
      await rm(operationStaging, { recursive: true, force: true })
      throw error
    }
  }

  async releaseDevPackage(source: string): Promise<void> {
    const item = this.transientPackages.get(source)
    if (item === undefined) return
    this.transientPackages.delete(source)
    await rm(item.directory, { recursive: true, force: true })
  }

  async cleanDevPackages(): Promise<void> {
    this.transientPackages.clear()
    await rm(this.devRoot, { recursive: true, force: true })
  }

  packageDirectory(name: string, version: string, source?: string): string {
    if (source?.startsWith('dev:') === true) {
      const item = this.transientPackages.get(source)
      if (item === undefined || item.manifest.name !== name || item.manifest.version !== version) {
        throw new Error(`Fabric dev package "${name}@${version}" is unavailable`)
      }
      return item.directory
    }
    return this.inventory.packagePath(name, version)
  }

  async removeVersion(name: string, version: string): Promise<void> {
    await rm(this.inventory.packagePath(name, version), { recursive: true, force: true })
  }

  async readManifest(name: string, version: string, source?: string): Promise<FabricRuntimePackageManifest> {
    const directory = this.packageDirectory(name, version, source)
    return validateFabricRuntimePackageManifest(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown, {
      expectedName: name,
      expectedVersion: version,
    })
  }

  async readClientBundle(name: string, version: string, source?: string): Promise<Uint8Array | undefined> {
    const manifest = await this.readManifest(name, version, source)
    const entry = manifest.fabric.client
    if (entry === undefined) return undefined
    const root = resolve(this.packageDirectory(name, version, source))
    const file = resolve(root, entry)
    if (relative(root, file).startsWith('..')) throw new Error('client entry escapes package root')
    return readFile(file)
  }
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function writeNotFound(res: ServerResponse, message: string): void {
  if (res.headersSent) return
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: { code: 'runtime-package-not-found', message } }))
}

/** Serve the Host-admitted active snapshot to one browser tab. */
export function runtimeInventoryRouteHandler(store: FabricPackageStore) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    writeJson(res, 200, store.inventory.readPublished())
  }
}

/** Push revision notifications; clients pull the complete snapshot after each event. */
export function runtimeInventoryEventsRouteHandler(store: FabricPackageStore, clients?: FabricRuntimeClientRegistry) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (inventory: FabricInventory): void => {
      if (res.writableEnded) return
      res.write(`data: ${JSON.stringify(inventory)}\n\n`)
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    let disconnectClient: (() => void) | undefined
    if (clients !== undefined) {
      const clientId = new URL(req.url ?? FABRIC_RUNTIME_INVENTORY_EVENTS_PATH, 'http://localhost').searchParams.get('clientId')
      if (clientId !== null) disconnectClient = clients.connect(clientId)
    }
    send(store.inventory.readPublished())
    const stop = store.inventory.subscribePublished(send)
    res.on('close', () => {
      stop()
      disconnectClient?.()
    })
  }
}

/** Serve only the enabled inventory version of a Runtime Package Client bundle. */
export function runtimePackageRouteHandler(store: FabricPackageStore) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? FABRIC_RUNTIME_PACKAGE_PREFIX, 'http://localhost')
    if (!url.pathname.startsWith(`${FABRIC_RUNTIME_PACKAGE_PREFIX}/`)) {
      writeNotFound(res, 'runtime package route not found')
      return
    }
    const parts = url.pathname.slice(FABRIC_RUNTIME_PACKAGE_PREFIX.length + 1).split('/')
    if (parts.length !== 3 || parts[2] !== 'client.js') {
      writeNotFound(res, 'runtime package client route not found')
      return
    }
    let name: string
    let version: string
    try {
      name = decodeURIComponent(parts[0]!)
      version = decodeURIComponent(parts[1]!)
    } catch {
      writeNotFound(res, 'runtime package route is malformed')
      return
    }
    const inventory = store.inventory.readPublished()
    const desired = inventory.plugins[name]
    if (desired?.enabled !== true || desired.version !== version) {
      writeNotFound(res, 'runtime package version is not active')
      return
    }
    const body = await store.readClientBundle(name, version, desired.source)
    if (body === undefined) {
      writeNotFound(res, 'runtime package has no Client half')
      return
    }
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'content-length': body.byteLength,
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') res.end()
    else res.end(body)
  }
}

export interface FabricPackageInstallResult {
  readonly name: string
  readonly entry: FabricInventoryEntry
}

export interface FabricPackageInstallOptions {
  readonly signal?: AbortSignal
  readonly expectedName?: string
  readonly fetcher?: FabricPackageFetcher
  readonly onStage?: (stage: 'downloading' | 'validating' | 'staging' | 'committing') => void
  readonly beforeCommit?: (
    name: string,
    current: FabricInventoryEntry | undefined,
    candidate: Readonly<{ version: string; source: string }>,
  ) => Promise<void>
}

export interface FabricPackageRollbackOptions {
  readonly signal?: AbortSignal
  readonly beforeCommit?: (
    name: string,
    current: FabricInventoryEntry,
    candidate: Readonly<{ version: string; source: string }>,
  ) => Promise<void>
}

export interface FabricPackageManager {
  inventory(): Promise<FabricInventory>
  install(source: string, options?: FabricPackageInstallOptions): Promise<FabricPackageInstallResult>
  update(name: string, options?: FabricPackageInstallOptions): Promise<FabricPackageInstallResult>
  enable(name: string): Promise<FabricInventoryEntry>
  disable(name: string): Promise<FabricInventoryEntry>
  rollback(name: string, options?: FabricPackageRollbackOptions): Promise<FabricInventoryEntry>
  remove(name: string): Promise<void>
  purge(name: string): Promise<void>
}

/** Desired-state manager for the local Runtime Package spike. */
export class LocalFabricPackageManager implements FabricPackageManager {
  private readonly busy = new Map<string, Promise<unknown>>()

  constructor(
    readonly store: FabricPackageStore,
    private readonly fabricApiVersion: string,
  ) {}

  inventory(): Promise<FabricInventory> {
    return this.store.inventory.read()
  }

  async install(source: string, options: FabricPackageInstallOptions = {}): Promise<FabricPackageInstallResult> {
    const resolved = await this.store.resolveSource(source, options)
    const name = resolved.expectedName ?? (await this.readSourceManifest(resolved.directory!)).name
    if (options.expectedName !== undefined && name !== options.expectedName) {
      throw new Error(`resolved package name "${name}" does not match requested "${options.expectedName}"`)
    }
    return this.mutate(name, async () => {
      const installed = await this.store.installResolved(resolved, {
        fabricApiVersion: this.fabricApiVersion,
        ...options,
      })
      try {
        throwIfAborted(options.signal)
        const before = (await this.store.inventory.read()).plugins[installed.manifest.name]
        const existingVersion = before?.version === installed.manifest.version
          ? { version: before.version, source: before.source }
          : before?.previous?.version === installed.manifest.version ? before.previous : undefined
        if (existingVersion !== undefined && existingVersion.source !== installed.source) {
          throw new Error(`fabric package "${installed.manifest.name}@${installed.manifest.version}" is already installed from a different source`)
        }
        if (installed.reused && existingVersion === undefined) {
          throw new Error(`fabric package "${installed.manifest.name}@${installed.manifest.version}" conflicts with an orphaned immutable version`)
        }
        if (before?.version === installed.manifest.version && before.source === installed.source) {
          return { name: installed.manifest.name, entry: before }
        }
        throwIfAborted(options.signal)
        await options.beforeCommit?.(installed.manifest.name, before, {
          version: installed.manifest.version,
          source: installed.source,
        })
        throwIfAborted(options.signal)
        options.onStage?.('committing')
        let staleVersion: string | undefined
        let entry!: FabricInventoryEntry
        await this.store.inventory.update(current => {
          const previous = current.plugins[installed.manifest.name]
          entry = {
            version: installed.manifest.version,
            source: installed.source,
            enabled: true,
            ...(previous === undefined || previous.version === installed.manifest.version
              ? (previous?.previous === undefined ? {} : { previous: previous.previous })
              : { previous: { version: previous.version, source: previous.source } }),
          }
          if (
            previous?.previous !== undefined
            && previous.previous.version !== entry.version
            && previous.previous.version !== entry.previous?.version
          ) staleVersion = previous.previous.version
          return { ...current.plugins, [installed.manifest.name]: entry }
        })
        if (staleVersion !== undefined) await this.store.removeVersion(installed.manifest.name, staleVersion)
        return { name: installed.manifest.name, entry }
      } catch (error) {
        await this.removeUnreferencedCandidate(installed.manifest.name, installed.manifest.version)
        throw error
      }
    })
  }

  async update(name: string, options: FabricPackageInstallOptions = {}): Promise<FabricPackageInstallResult> {
    if (!isFabricPackageName(name)) throw new Error(`fabric package name "${name}" is invalid`)
    const entry = (await this.store.inventory.read()).plugins[name]
    if (entry === undefined) throw new Error(`fabric package "${name}" is not installed`)
    return this.install(entry.source, { ...options, expectedName: name })
  }

  async enable(name: string): Promise<FabricInventoryEntry> {
    return this.mutate(name, async () => {
      const current = await this.store.inventory.read()
      const entry = current.plugins[name]
      if (entry === undefined) throw new Error(`fabric package "${name}" is not installed`)
      const next = { ...entry, enabled: true }
      await this.store.inventory.update(value => ({ ...value.plugins, [name]: next }))
      return next
    })
  }

  async disable(name: string): Promise<FabricInventoryEntry> {
    return this.mutate(name, async () => {
      const current = await this.store.inventory.read()
      const entry = current.plugins[name]
      if (entry === undefined) throw new Error(`fabric package "${name}" is not installed`)
      const next = { ...entry, enabled: false }
      await this.store.inventory.update(value => ({ ...value.plugins, [name]: next }))
      return next
    })
  }

  async rollback(name: string, options: FabricPackageRollbackOptions = {}): Promise<FabricInventoryEntry> {
    return this.mutate(name, async () => {
      const current = await this.store.inventory.read()
      const entry = current.plugins[name]
      if (entry === undefined) throw new Error(`fabric package "${name}" is not installed`)
      if (entry.previous === undefined) throw new Error(`fabric package "${name}" has no previous version`)
      const next: FabricInventoryEntry = {
        version: entry.previous.version,
        source: entry.previous.source,
        enabled: true,
        previous: { version: entry.version, source: entry.source },
      }
      throwIfAborted(options.signal)
      await options.beforeCommit?.(name, entry, next)
      throwIfAborted(options.signal)
      await this.store.inventory.update(value => ({ ...value.plugins, [name]: next }))
      return next
    })
  }

  async remove(name: string): Promise<void> {
    await this.mutate(name, async () => { await this.removeInstalled(name, true) })
  }

  async purge(name: string): Promise<void> {
    if (!isFabricPackageName(name)) throw new Error(`fabric package name "${name}" is invalid`)
    await this.mutate(name, async () => {
      await this.removeInstalled(name, false)
      await rm(this.store.inventory.dataPath(name), { recursive: true, force: true })
    })
  }

  private async removeInstalled(name: string, requireInstalled: boolean): Promise<void> {
    const current = await this.store.inventory.read()
    const entry = current.plugins[name]
    if (entry === undefined) {
      if (requireInstalled) throw new Error(`fabric package "${name}" is not installed`)
      return
    }
    await this.store.inventory.update(value => {
      const plugins = { ...value.plugins }
      delete plugins[name]
      return plugins
    })
    await this.store.removeVersion(name, entry.version)
    if (entry.previous !== undefined) await this.store.removeVersion(name, entry.previous.version)
  }

  private async readSourceManifest(source: string): Promise<FabricRuntimePackageManifest> {
    return validateFabricRuntimePackageManifest(JSON.parse(await readFile(join(resolve(source), 'package.json'), 'utf8')) as unknown, {
      fabricApiVersion: this.fabricApiVersion,
    })
  }

  private async removeUnreferencedCandidate(name: string, version: string): Promise<void> {
    const entry = (await this.store.inventory.read()).plugins[name]
    if (entry?.version === version || entry?.previous?.version === version) return
    await this.store.removeVersion(name, version)
  }

  private async mutate<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.busy.get(name)
    if (previous !== undefined) throw new Error(`fabric package "${name}" is busy`)
    const task = operation()
    this.busy.set(name, task)
    try {
      return await task
    } finally {
      if (this.busy.get(name) === task) this.busy.delete(name)
    }
  }
}

