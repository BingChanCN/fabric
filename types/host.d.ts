import type { ReactNode } from 'react'

export type FabricResourceScope = 'profile' | 'session'
export interface FabricSessionRef { readonly id: string }
export interface FabricCodec<T> { parse(value: unknown): T }
export interface FabricResourceDefinition<Request, Response, Event = never> {
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
  readonly session: FabricSessionRef | undefined
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
export interface FabricAssetContext { readonly pluginId: string; readonly assetId: string; readonly path: string; readonly method: string; readonly signal: AbortSignal }
export interface FabricAssetResponse { readonly status?: number; readonly contentType: string; readonly body: Uint8Array; readonly cacheControl?: string }
export type FabricAssetHandler = (context: FabricAssetContext) => FabricAssetResponse | Promise<FabricAssetResponse | undefined> | undefined
export interface FabricAssetHost { provide(pluginId: string, assetId: string, handler: FabricAssetHandler): () => void }
export interface FabricResourceHost {
  readonly assets: FabricAssetHost
  provide<Request, Response, Event>(pluginId: string, resource: FabricResourceDefinition<Request, Response, Event>, handlers: FabricResourceHandlers<Request, Response, Event>): () => void
}
/** Host provider facade bound to one Fabric plugin scope. */
export interface FabricPluginResourceHost {
  readonly assets: { provide(assetId: string, handler: FabricAssetHandler): () => void }
  provide<Request, Response, Event>(resource: FabricResourceDefinition<Request, Response, Event>, handlers: FabricResourceHandlers<Request, Response, Event>): () => void
}

export interface FabricHostPluginDescriptor { readonly name: string; readonly description?: string; readonly icon?: ReactNode }
export interface FabricHostPluginIdentity extends FabricHostPluginDescriptor {
  /** Short runtime namespace used by Fabric registries and Resource routes. */
  readonly id: string
  /** Full npm package name used by the ModuleLoader/profile identity. */
  readonly packageName: string
  readonly version: string
}
export interface FabricHostLifecycle { readonly signal: AbortSignal; onDispose(cleanup: () => void): void }
export interface FabricHostPluginContext { readonly identity: FabricHostPluginIdentity; readonly lifecycle: FabricHostLifecycle; readonly resources: FabricPluginResourceHost }
export interface FabricHostPluginDefinition { readonly descriptor: FabricHostPluginDescriptor; readonly setup: (context: FabricHostPluginContext) => void | (() => void) }
export declare function defineHostPlugin(definition: FabricHostPluginDefinition): FabricHostPluginDefinition
export declare function mountHostPlugin(packageName: string, version: string, definition: FabricHostPluginDefinition): { readonly inject: readonly ['fabricHost']; readonly apply: (ctx: unknown) => void }
export declare function defineCodec<T>(parse: (value: unknown) => T): FabricCodec<T>
export declare function defineResource<Request, Response, Event = never>(definition: FabricResourceDefinition<Request, Response, Event>): FabricResourceDefinition<Request, Response, Event>
export declare const jsonCodec: FabricCodec<unknown>
export declare const voidCodec: FabricCodec<void>
export declare class FabricResourceError extends Error { readonly code: string; readonly details: unknown; readonly retryable: boolean }
export declare const FabricResourceHostService: new () => FabricResourceHost
export declare const FABRIC_RESOURCE_PREFIX: string
export declare const FABRIC_ASSET_PREFIX: string
export declare function assetUrl(pluginId: string, assetId: string, assetPath: string): string
