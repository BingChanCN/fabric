export * from './host'

import type {
  FabricHostPluginDefinition,
  FabricResourceDefinition,
  FabricResourceHandlers,
} from './host'

export interface FabricHostPluginActivation {
  readonly generation?: string
}

export declare function mountHostPlugin(
  packageName: string,
  version: string,
  definition: FabricHostPluginDefinition,
  activation?: FabricHostPluginActivation,
): {
  readonly inject: readonly ['fabricHost']
  readonly apply: (ctx: unknown) => Promise<void>
}

export interface FabricAssetContext {
  readonly pluginId: string
  readonly assetId: string
  readonly path: string
  readonly method: string
  readonly signal: AbortSignal
}

export interface FabricAssetResponse {
  readonly status?: number
  readonly contentType: string
  readonly body: Uint8Array
  readonly cacheControl?: string
}

export type FabricAssetHandler = (
  context: FabricAssetContext,
) => FabricAssetResponse | Promise<FabricAssetResponse | undefined> | undefined

export declare class FabricResourceHostService {
  readonly assets: {
    provide(pluginId: string, assetId: string, handler: FabricAssetHandler): () => void
  }
  provide<Request, Response, Event = never>(
    pluginId: string,
    resource: FabricResourceDefinition<Request, Response, Event>,
    handlers: FabricResourceHandlers<Request, Response, Event>,
  ): () => void
}

export declare const FABRIC_RESOURCE_PREFIX: string
export declare const FABRIC_ASSET_PREFIX: string
export declare function assetUrl(pluginId: string, assetId: string, assetPath: string): string
