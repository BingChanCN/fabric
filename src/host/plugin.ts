import type { ReactNode } from 'react'
import type { FabricPluginResourceHost, FabricResourceHost } from '../resource/contract.ts'
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
}

export interface FabricHostLifecycle {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void): void
}

export interface FabricHostPluginContext {
  readonly identity: FabricHostPluginIdentity
  readonly lifecycle: FabricHostLifecycle
  readonly resources: FabricPluginResourceHost
}

export interface FabricHostPluginDefinition {
  readonly descriptor: FabricHostPluginDescriptor
  readonly setup: (context: FabricHostPluginContext) => void | (() => void)
}

export function defineHostPlugin(definition: FabricHostPluginDefinition): FabricHostPluginDefinition {
  if (definition.descriptor.name.trim() === '') throw new Error('fabric plugin name must not be empty')
  return Object.freeze(definition)
}

type DshContext = {
  readonly fabricHost?: FabricResourceHost
  effect(setup: () => void | (() => void), name?: string): unknown
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

export function mountHostPlugin(
  packageName: string,
  version: string,
  definition: FabricHostPluginDefinition,
): { readonly inject: readonly ['fabricHost']; readonly apply: (ctx: unknown) => void } {
  const identity: FabricHostPluginIdentity = {
    id: runtimePluginId(packageName),
    packageName,
    version,
    name: definition.descriptor.name,
    ...(definition.descriptor.description === undefined ? {} : { description: definition.descriptor.description }),
    ...(definition.descriptor.icon === undefined ? {} : { icon: definition.descriptor.icon }),
  }
  return {
    inject: ['fabricHost'],
    apply(rawContext: unknown): void {
      const ctx = rawContext as DshContext
      const runtime = ctx.fabricHost
      if (runtime === undefined) throw new Error(`fabric host plugin "${identity.id}" started before the Fabric runtime`)
      const controller = new AbortController()
      const cleanups = new Set<() => void>()
      const lifecycle: FabricHostLifecycle = {
        signal: controller.signal,
        onDispose(cleanup) { cleanups.add(cleanup) },
      }
      const resources = scopeHostResources(runtime, identity.id, lifecycle)
      let setupCleanup: void | (() => void)
      try {
        setupCleanup = definition.setup({ identity, lifecycle, resources })
      } catch (error) {
        controller.abort()
        for (const cleanup of [...cleanups].reverse()) cleanup()
        cleanups.clear()
        throw error
      }
      if (setupCleanup !== undefined) lifecycle.onDispose(setupCleanup)
      ctx.effect(() => () => {
        controller.abort()
        for (const cleanup of [...cleanups].reverse()) cleanup()
        cleanups.clear()
      }, `fabric host plugin: ${identity.id}`)
    },
  }
}

export type { FabricResourceHost } from '../resource/contract.ts'
