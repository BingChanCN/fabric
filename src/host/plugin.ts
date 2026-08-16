import type { ReactNode } from 'react'
import type { FabricPluginResourceHost, FabricResourceHost } from '../resource/contract.ts'
import type {
  FabricOperationDefinition, FabricOperationHandler, FabricPluginOperationHost,
} from '../operation/contract.ts'
import type {
  FabricDocumentDefinition, FabricDocumentHandle, FabricDocumentHost, FabricPluginDocumentHost,
} from '../document/contract.ts'
import type { FabricBlobHost, FabricPluginBlobHost } from '../blob/contract.ts'
import type {
  FabricCredentialDefinition, FabricCredentialHost, FabricPluginCredentialHost,
} from '../credential/contract.ts'
import { runtimePluginId } from '../plugin-identity.ts'

export interface FabricHostPluginDescriptor {
  readonly name: string
  readonly description?: string
  readonly icon?: ReactNode
}

export interface FabricHostPluginIdentity extends FabricHostPluginDescriptor {
  /** Short runtime namespace used by Fabric registries and Resource routes. */
  readonly id: string
  /** Full npm package name used by the ModuleLoader/profile identity. */
  readonly packageName: string
  readonly version: string
  /** Core-issued activation generation; Runtime Packages cannot choose it. */
  readonly generation: string
}

export interface FabricHostPluginActivation {
  readonly generation?: string
}

export type FabricHostDisposer = () => void | Promise<void>

export interface FabricHostLifecycle {
  readonly signal: AbortSignal
  onDispose(cleanup: FabricHostDisposer): void
}

export interface FabricHostPluginContext {
  readonly identity: FabricHostPluginIdentity
  readonly lifecycle: FabricHostLifecycle
  readonly resources: FabricPluginResourceHost
  readonly operations: FabricPluginOperationHost
  readonly documents: FabricPluginDocumentHost
  readonly blobs: FabricPluginBlobHost
  readonly credentials: FabricPluginCredentialHost
}

export interface FabricHostPluginDefinition {
  readonly descriptor: FabricHostPluginDescriptor
  readonly setup: (context: FabricHostPluginContext) => void | FabricHostDisposer | Promise<void | FabricHostDisposer>
}

export function defineHostPlugin(definition: FabricHostPluginDefinition): FabricHostPluginDefinition {
  if (definition.descriptor.name.trim() === '') throw new Error('fabric plugin name must not be empty')
  return Object.freeze(definition)
}

type DshContext = {
  readonly fabricHost?: FabricResourceHost & {
    readonly documents?: FabricDocumentHost
    readonly blobs?: FabricBlobHost
    readonly credentials?: FabricCredentialHost
  }
  effect(setup: () => void | FabricHostDisposer, name?: string): unknown
}

function scopeHostResources(host: FabricResourceHost, pluginId: string, lifecycle: FabricHostLifecycle): FabricPluginResourceHost {
  const disposers = new Set<() => void>()
  const bind = (dispose: () => void): (() => void) => {
    disposers.add(dispose)
    return () => {
      if (!disposers.delete(dispose)) return
      dispose()
    }
  }
  lifecycle.onDispose(() => {
    for (const dispose of [...disposers].reverse()) dispose()
    disposers.clear()
  })
  return {
    assets: {
      provide(assetId, handler) {
        return bind(host.assets.provide(pluginId, assetId, handler))
      },
    },
    provide(resource, handlers) {
      return bind(host.provide(pluginId, resource, handlers))
    },
  }
}

function scopeHostCredentials(
  host: FabricCredentialHost | undefined,
  packageName: string,
  lifecycle: FabricHostLifecycle,
): FabricPluginCredentialHost {
  if (host === undefined) {
    const unavailable = async (): Promise<never> => { throw new Error('Fabric Credential service is unavailable') }
    return { declare() { throw new Error('Fabric Credential service is unavailable') }, resolve: unavailable, describe: unavailable }
  }
  const declared = new Set<() => void>()
  lifecycle.onDispose(() => {
    for (const dispose of [...declared].reverse()) dispose()
    declared.clear()
  })
  const validateOwner = (definition: FabricCredentialDefinition): void => {
    if (definition.owner !== packageName) {
      throw new Error(`fabric credential consumer "${packageName}" cannot access "${definition.owner}/${definition.id}"`)
    }
  }
  return {
    declare(definition) {
      validateOwner(definition)
      const dispose = host.declare(packageName, definition)
      declared.add(dispose)
    },
    resolve(definition) {
      validateOwner(definition)
      return host.resolve(packageName, definition)
    },
    describe(definition) {
      validateOwner(definition)
      return host.describe(packageName, definition)
    },
  }
}

function scopeHostBlobs(host: FabricBlobHost | undefined, packageName: string): FabricPluginBlobHost {
  if (host === undefined) {
    const unavailable = async (): Promise<never> => { throw new Error('Fabric Blob service is unavailable') }
    return {
      put: unavailable,
      read: unavailable,
      delete: unavailable,
      url() { throw new Error('Fabric Blob service is unavailable') },
    }
  }
  return host.forOwner(packageName)
}

function scopeHostDocuments(
  host: FabricDocumentHost | undefined,
  packageName: string,
  lifecycle: FabricHostLifecycle,
): FabricPluginDocumentHost {
  const handles = new Set<FabricDocumentHandle<unknown>>()
  lifecycle.onDispose(() => {
    for (const handle of [...handles]) handle.close()
    handles.clear()
  })
  return {
    async open<T>(definition: FabricDocumentDefinition<T>): Promise<FabricDocumentHandle<T>> {
      if (host === undefined) throw new Error('Fabric Document service is unavailable')
      const handle = await host.open(packageName, definition)
      if (lifecycle.signal.aborted) {
        handle.close()
        throw new DOMException('fabric host plugin disposed', 'AbortError')
      }
      handles.add(handle as FabricDocumentHandle<unknown>)
      return handle
    },
  }
}

function scopeHostOperations(
  host: FabricResourceHost,
  packageName: string,
  lifecycle: FabricHostLifecycle,
): FabricPluginOperationHost {
  const disposers = new Set<() => void>()
  lifecycle.onDispose(() => {
    for (const dispose of [...disposers].reverse()) dispose()
    disposers.clear()
  })
  return {
    provide<Input, Result, Progress>(
      operation: FabricOperationDefinition<Input, Result, Progress>,
      handler: FabricOperationHandler<Input, Result, Progress>,
    ): () => void {
      if (operation.owner !== packageName) {
        throw new Error(`fabric operation provider "${packageName}" cannot provide "${operation.owner}/${operation.id}"`)
      }
      const disposeProvider = host.operations.provide(operation, handler)
      disposers.add(disposeProvider)
      return () => {
        if (!disposers.delete(disposeProvider)) return
        disposeProvider()
      }
    },
  }
}

export function mountHostPlugin(
  packageName: string,
  version: string,
  definition: FabricHostPluginDefinition,
  activation: FabricHostPluginActivation = {},
): { readonly inject: readonly ['fabricHost']; readonly apply: (ctx: unknown) => Promise<void> } {
  const identity: FabricHostPluginIdentity = {
    id: runtimePluginId(packageName),
    packageName,
    version,
    generation: activation.generation ?? `static:${version}`,
    name: definition.descriptor.name,
    ...(definition.descriptor.description === undefined ? {} : { description: definition.descriptor.description }),
    ...(definition.descriptor.icon === undefined ? {} : { icon: definition.descriptor.icon }),
  }
  return {
    inject: ['fabricHost'],
    async apply(rawContext: unknown): Promise<void> {
      const ctx = rawContext as DshContext
      const runtime = ctx.fabricHost
      if (runtime === undefined) throw new Error(`fabric host plugin "${identity.id}" started before the Fabric runtime`)
      const controller = new AbortController()
      const cleanups = new Set<FabricHostDisposer>()
      let disposePromise: Promise<void> | undefined
      const dispose = (): Promise<void> => {
        disposePromise ??= (async () => {
          controller.abort()
          for (const cleanup of [...cleanups].reverse()) await cleanup()
          cleanups.clear()
        })()
        return disposePromise
      }
      const lifecycle: FabricHostLifecycle = {
        signal: controller.signal,
        onDispose(cleanup) {
          if (controller.signal.aborted) void cleanup()
          else cleanups.add(cleanup)
        },
      }
      const resources = scopeHostResources(runtime, identity.packageName, lifecycle)
      const operations = scopeHostOperations(runtime, identity.packageName, lifecycle)
      const documents = scopeHostDocuments(runtime.documents, identity.packageName, lifecycle)
      const blobs = scopeHostBlobs(runtime.blobs, identity.packageName)
      const credentials = scopeHostCredentials(runtime.credentials, identity.packageName, lifecycle)
      ctx.effect(() => dispose, `fabric host plugin: ${identity.id}`)
      try {
        const setupCleanup = await definition.setup({ identity, lifecycle, resources, operations, documents, blobs, credentials })
        if (setupCleanup !== undefined) {
          if (controller.signal.aborted) await setupCleanup()
          else lifecycle.onDispose(setupCleanup)
        }
      } catch (error) {
        await dispose()
        throw error
      }
    },
  }
}

export type { FabricResourceHost } from '../resource/contract.ts'
