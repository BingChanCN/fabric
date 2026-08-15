import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  FabricAssetContext, FabricAssetHandler, FabricAssetHost, FabricCodec, FabricResourceContext,
  FabricResourceDefinition, FabricResourceErrorPayload, FabricResourceHandlers, FabricResourceHost,
  FabricSessionRef,
} from '../resource/contract.ts'
import { FabricResourceError } from '../resource/contract.ts'

export const FABRIC_RESOURCE_PREFIX = '/fabric/resource'
export const FABRIC_ASSET_PREFIX = '/fabric/asset'

type RegisteredResource = {
  readonly pluginId: string
  readonly resource: FabricResourceDefinition<unknown, unknown, unknown>
  readonly handlers: FabricResourceHandlers<unknown, unknown, unknown>
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of req) body += chunk.toString()
  return body.trim() === '' ? undefined : JSON.parse(body)
}

function errorPayload(error: unknown): FabricResourceErrorPayload {
  if (error instanceof FabricResourceError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: error.retryable,
    }
  }
  if (error instanceof Error) return { code: 'resource-failed', message: error.message }
  return { code: 'resource-failed', message: String(error) }
}

function errorStatus(error: unknown): number {
  if (error instanceof FabricResourceError) {
    return error.code === 'config-conflict' ? 409 : 400
  }
  return 500
}

function pathParts(pathname: string): { pluginId: string; resourceId: string; operation: string } | undefined {
  if (!pathname.startsWith(`${FABRIC_RESOURCE_PREFIX}/`)) return undefined
  const parts = pathname.slice(FABRIC_RESOURCE_PREFIX.length + 1).split('/')
  if (parts.length !== 3) return undefined
  const [encodedPlugin, encodedResource, operation] = parts
  if (encodedPlugin === undefined || encodedResource === undefined || operation === undefined) return undefined
  return {
    pluginId: decodeURIComponent(encodedPlugin),
    resourceId: decodeURIComponent(encodedResource),
    operation,
  }
}

function sessionFromUrl(url: URL): FabricSessionRef | undefined {
  const id = url.searchParams.get('sessionId')
  return id === null || id.trim() === '' ? undefined : { id }
}

type RegisteredAsset = {
  readonly pluginId: string
  readonly assetId: string
  readonly handler: FabricAssetHandler
}

class FabricAssetHostService implements FabricAssetHost {
  private readonly assets = new Map<string, RegisteredAsset>()

  provide(pluginId: string, assetId: string, handler: FabricAssetHandler): () => void {
    const key = `${pluginId}/${assetId}`
    if (this.assets.has(key)) throw new Error(`fabric asset "${key}" is already provided`)
    const record = { pluginId, assetId, handler }
    this.assets.set(key, record)
    return () => {
      if (this.assets.get(key) === record) this.assets.delete(key)
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? FABRIC_ASSET_PREFIX, `http://${req.headers.host ?? 'localhost'}`)
    if (!url.pathname.startsWith(`${FABRIC_ASSET_PREFIX}/`)) {
      writeJson(res, 404, { error: { code: 'asset-not-found', message: 'asset route not found' } })
      return
    }
    const parts = url.pathname.slice(FABRIC_ASSET_PREFIX.length + 1).split('/')
    if (parts.length < 3) {
      writeJson(res, 404, { error: { code: 'asset-not-found', message: 'asset route not found' } })
      return
    }
    const pluginId = decodeURIComponent(parts[0]!)
    const assetId = decodeURIComponent(parts[1]!)
    const assetPath = parts.slice(2).map(part => decodeURIComponent(part)).join('/')
    const record = this.assets.get(`${pluginId}/${assetId}`)
    if (record === undefined) {
      writeJson(res, 404, { error: { code: 'asset-not-found', message: 'asset is not registered' } })
      return
    }
    const abort = new AbortController()
    const abortRequest = (): void => { abort.abort() }
    req.on('aborted', abortRequest)
    res.on('close', abortRequest)
    const context: FabricAssetContext = {
      pluginId,
      assetId,
      path: assetPath,
      method: req.method ?? 'GET',
      signal: abort.signal,
    }
    try {
      const output = await record.handler(context)
      if (output === undefined) {
        writeJson(res, 404, { error: { code: 'asset-not-found', message: 'asset does not exist' } })
        return
      }
      res.writeHead(output.status ?? 200, {
        'content-type': output.contentType,
        'content-length': output.body.byteLength,
        'cache-control': output.cacheControl ?? 'no-store',
      })
      if (context.method !== 'HEAD') res.end(output.body)
      else res.end()
    } catch (error) {
      writeJson(res, 500, { error: errorPayload(error) })
    }
  }
}

/** One host-side dispatcher for every Fabric resource in the profile. */
export class FabricResourceHostService implements FabricResourceHost {
  readonly assets = new FabricAssetHostService()
  private readonly resources = new Map<string, RegisteredResource>()

  provide<Request, Response, Event>(
    pluginId: string,
    resource: FabricResourceDefinition<Request, Response, Event>,
    handlers: FabricResourceHandlers<Request, Response, Event>,
  ): () => void {
    const key = `${pluginId}/${resource.id}`
    if (this.resources.has(key)) throw new Error(`fabric resource "${key}" is already provided`)
    const record: RegisteredResource = {
      pluginId,
      resource: resource as FabricResourceDefinition<unknown, unknown, unknown>,
      handlers: handlers as FabricResourceHandlers<unknown, unknown, unknown>,
    }
    this.resources.set(key, record)
    return () => {
      if (this.resources.get(key) === record) this.resources.delete(key)
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? FABRIC_RESOURCE_PREFIX, `http://${req.headers.host ?? 'localhost'}`)
    const parts = pathParts(url.pathname)
    if (parts === undefined) {
      writeJson(res, 404, { error: { code: 'resource-not-found', message: 'resource route not found' } })
      return
    }
    const record = this.resources.get(`${parts.pluginId}/${parts.resourceId}`)
    if (record === undefined) {
      writeJson(res, 404, { error: { code: 'resource-not-found', message: 'resource is not registered' } })
      return
    }
    const operation = parts.operation as 'query' | 'mutate' | 'stream'
    const handler = record.handlers[operation]
    if (handler === undefined) {
      writeJson(res, 405, { error: { code: 'operation-not-supported', message: `operation "${parts.operation}" is not supported` } })
      return
    }
    if (record.resource.scope === 'session' && sessionFromUrl(url) === undefined) {
      writeJson(res, 400, { error: { code: 'session-required', message: 'a session resource requires an explicit session' } })
      return
    }

    const abort = new AbortController()
    const abortRequest = (): void => { abort.abort() }
    req.on('aborted', abortRequest)
    res.on('close', abortRequest)
    const session = record.resource.scope === 'session' ? sessionFromUrl(url) : undefined
    const context: FabricResourceContext = {
      pluginId: record.pluginId,
      resourceId: record.resource.id,
      scope: record.resource.scope,
      session,
      signal: abort.signal,
    }

    try {
      if (operation === 'stream') {
        const streamHandler = record.handlers.stream
        if (streamHandler === undefined) throw new Error('stream handler disappeared')
        await this.handleStream(req, res, url, record, context, streamHandler)
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: { code: 'method-not-allowed', message: 'resource operations use POST' } })
        return
      }
      const input = record.resource.request.parse(await readJson(req))
      const resolver = operation === 'query' ? record.handlers.query : record.handlers.mutate
      if (resolver === undefined) throw new Error(`operation "${operation}" is not supported`)
      const output = await resolver(input, context)
      const response = record.resource.response.parse(output)
      writeJson(res, 200, { data: response })
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end()
      } else {
        writeJson(res, errorStatus(error), { error: errorPayload(error) })
      }
    }
  }

  private async handleStream(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    record: RegisteredResource,
    context: FabricResourceContext,
    handler: NonNullable<RegisteredResource['handlers']['stream']>,
  ): Promise<void> {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: { code: 'method-not-allowed', message: 'resource streams use GET' } })
      return
    }
    const rawInput = url.searchParams.get('input')
    const input = record.resource.request.parse(rawInput === null ? undefined : JSON.parse(rawInput))
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
    })
    const emit = (event: unknown): void => {
      if (context.signal.aborted || res.writableEnded) return
      const parsed = record.resource.event?.parse(event) ?? event
      res.write(`data: ${JSON.stringify(parsed)}\n\n`)
    }
    const cleanup = await handler(input, context, emit)
    if (cleanup !== undefined) context.signal.addEventListener('abort', cleanup, { once: true })
    if (!context.signal.aborted && !res.writableEnded) {
      await new Promise<void>(resolve => {
        const finish = (): void => {
          if (!res.writableEnded) res.end()
          resolve()
        }
        context.signal.addEventListener('abort', finish, { once: true })
        res.on('close', finish)
      })
    }
  }
}

export function resourceRouteHandler(service: FabricResourceHostService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    void service.handle(req, res)
  }
}

export function assetRouteHandler(service: FabricResourceHostService) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    void service.assets.handle(req, res)
  }
}

export function parseResourceError(value: unknown): FabricResourceError {
  const payload = value as { code?: unknown; message?: unknown; details?: unknown; retryable?: unknown }
  return new FabricResourceError({
    code: typeof payload.code === 'string' ? payload.code : 'resource-failed',
    message: typeof payload.message === 'string' ? payload.message : 'resource request failed',
    ...(payload.details === undefined ? {} : { details: payload.details }),
    ...(typeof payload.retryable === 'boolean' ? { retryable: payload.retryable } : {}),
  })
}

export function resourceUrl(pluginId: string, resourceId: string, operation: string): string {
  return `${FABRIC_RESOURCE_PREFIX}/${encodeURIComponent(pluginId)}/${encodeURIComponent(resourceId)}/${operation}`
}

export function resourceInputUrl(url: string, input: unknown, session: FabricSessionRef | undefined): string {
  const query = new URLSearchParams({ input: JSON.stringify(input) })
  if (session !== undefined) query.set('sessionId', session.id)
  return `${url}?${query.toString()}`
}
