import type { EventStream, EventStreamSnapshot } from '../sdk/sse.ts'

export type FabricResourceScope = 'profile' | 'session'

export interface FabricSessionRef {
  readonly id: string
}

export interface FabricCodec<T> {
  parse(value: unknown): T
}

export function defineCodec<T>(parse: (value: unknown) => T): FabricCodec<T> {
  return Object.freeze({ parse })
}

export const voidCodec: FabricCodec<void> = defineCodec(value => {
  if (value !== undefined && value !== null) throw new Error('expected an empty resource input')
})

export const jsonCodec: FabricCodec<unknown> = defineCodec(value => value)

const RESOURCE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u

export interface FabricResourceDefinition<Request, Response, Event = never> {
  readonly id: string
  readonly version: string
  readonly scope: FabricResourceScope
  readonly request: FabricCodec<Request>
  readonly response: FabricCodec<Response>
  readonly event?: FabricCodec<Event>
}

export function defineResource<Request, Response, Event = never>(
  definition: FabricResourceDefinition<Request, Response, Event>,
): FabricResourceDefinition<Request, Response, Event> {
  if (!RESOURCE_ID.test(definition.id)) {
    throw new Error(`fabric resource id "${definition.id}" is invalid`)
  }
  return Object.freeze({ ...definition })
}

export interface FabricResourceContext {
  readonly pluginId: string
  readonly resourceId: string
  readonly scope: FabricResourceScope
  readonly session: FabricSessionRef | undefined
  readonly signal: AbortSignal
}

export type FabricResourceHandler<Request, Response> = (
  request: Request,
  context: FabricResourceContext,
) => Response | Promise<Response>

export type FabricResourceEmitter<Event> = (event: Event) => void

export type FabricResourceStreamHandler<Request, Event> = (
  request: Request,
  context: FabricResourceContext,
  emit: FabricResourceEmitter<Event>,
) => void | (() => void) | Promise<void | (() => void)>

export interface FabricResourceHandlers<Request, Response, Event = never> {
  readonly query?: FabricResourceHandler<Request, Response>
  readonly mutate?: FabricResourceHandler<Request, Response>
  readonly stream?: FabricResourceStreamHandler<Request, Event>
}

export interface FabricResourceRequestOptions {
  readonly signal?: AbortSignal
  readonly session?: FabricSessionRef
}

export interface FabricResourceWatchOptions extends FabricResourceRequestOptions {
  readonly minRetryMs?: number
  readonly maxRetryMs?: number
}

export interface FabricResourceErrorPayload {
  readonly code: string
  readonly message: string
  readonly details?: unknown
  readonly retryable?: boolean
}

export class FabricResourceError extends Error {
  readonly code: string
  readonly details: unknown
  readonly retryable: boolean

  constructor(payload: FabricResourceErrorPayload) {
    super(payload.message)
    this.name = 'FabricResourceError'
    this.code = payload.code
    this.details = payload.details
    this.retryable = payload.retryable ?? false
  }
}

export interface FabricResourceClient {
  read<Request, Response>(
    resource: FabricResourceDefinition<Request, Response, never>,
    request: Request,
    options?: FabricResourceRequestOptions,
  ): Promise<Response>
  mutate<Request, Response>(
    resource: FabricResourceDefinition<Request, Response, never>,
    request: Request,
    options?: FabricResourceRequestOptions,
  ): Promise<Response>
  watch<Request, Event>(
    resource: FabricResourceDefinition<Request, unknown, Event> & { readonly event: FabricCodec<Event> },
    request: Request,
    options?: FabricResourceWatchOptions,
  ): EventStream<Event>
}

export type FabricResourceWatchSnapshot<Event> = EventStreamSnapshot<Event>

export function assetUrl(pluginId: string, assetId: string, assetPath: string): string {
  const path = assetPath.split('/').map(part => encodeURIComponent(part)).join('/')
  return `/fabric/asset/${encodeURIComponent(pluginId)}/${encodeURIComponent(assetId)}/${path}`
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

export type FabricAssetHandler = (context: FabricAssetContext) => FabricAssetResponse | Promise<FabricAssetResponse | undefined> | undefined

export interface FabricAssetHost {
  provide(pluginId: string, assetId: string, handler: FabricAssetHandler): () => void
}

export interface FabricResourceHost {
  readonly assets: FabricAssetHost
  provide<Request, Response, Event>(
    pluginId: string,
    resource: FabricResourceDefinition<Request, Response, Event>,
    handlers: FabricResourceHandlers<Request, Response, Event>,
  ): () => void
}

/** Host provider facade bound to one Fabric plugin scope. */
export interface FabricPluginResourceHost {
  readonly assets: {
    provide(assetId: string, handler: FabricAssetHandler): () => void
  }
  provide<Request, Response, Event>(
    resource: FabricResourceDefinition<Request, Response, Event>,
    handlers: FabricResourceHandlers<Request, Response, Event>,
  ): () => void
}
