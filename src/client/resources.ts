import { createEventStream, type EventStream } from '../sdk/sse.ts'
import type {
  FabricResourceClient, FabricResourceDefinition, FabricResourceRequestOptions,
  FabricResourceWatchOptions,
} from '../resource/contract.ts'
import { FabricResourceError } from '../resource/contract.ts'
const RESOURCE_PREFIX = '/fabric/resource'

interface ResourceOwner {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void): void
}

function ownedSignal(owner: AbortSignal | undefined, request: AbortSignal | undefined): {
  signal: AbortSignal | undefined
  dispose: () => void
} {
  if (owner === undefined) return { signal: request, dispose: () => {} }
  if (request === undefined || request === owner) return { signal: owner, dispose: () => {} }
  const controller = new AbortController()
  const abort = (): void => { controller.abort() }
  if (owner.aborted || request.aborted) abort()
  else {
    owner.addEventListener('abort', abort, { once: true })
    request.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      owner.removeEventListener('abort', abort)
      request.removeEventListener('abort', abort)
    },
  }
}

function resourceUrl(pluginId: string, resourceId: string, operation: string): string {
  return `${RESOURCE_PREFIX}/${encodeURIComponent(pluginId)}/${encodeURIComponent(resourceId)}/${operation}`
}

function resourceInputUrl(url: string, version: string, input: unknown): string {
  const query = new URLSearchParams({ version })
  if (input !== undefined) query.set('input', JSON.stringify(input))
  return `${url}?${query.toString()}`
}

async function parseResponse(response: Response): Promise<unknown> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new FabricResourceError({ code: 'invalid-resource-response', message: 'resource returned invalid JSON' })
  }
  if (!response.ok) {
    const error = (payload as { error?: unknown } | null)?.error
    const value = error !== undefined ? error : payload
    const details = value as { code?: unknown; message?: unknown; details?: unknown; retryable?: unknown }
    throw new FabricResourceError({
      code: typeof details?.code === 'string' ? details.code : `http-${response.status}`,
      message: typeof details?.message === 'string' ? details.message : `resource request failed (${response.status})`,
      ...(details?.details === undefined ? {} : { details: details.details }),
      ...(typeof details?.retryable === 'boolean' ? { retryable: details.retryable } : {}),
    })
  }
  return payload
}

/** Browser transport for the profile's single Fabric resource dispatcher. */
export class FabricResourceClientService implements FabricResourceClient {
  constructor(
    _consumerId: string,
    private readonly owner: ResourceOwner | undefined = undefined,
  ) {}

  async read<Request, Response>(
    resource: FabricResourceDefinition<Request, Response, never>,
    request: Request,
    options: FabricResourceRequestOptions = {},
  ): Promise<Response> {
    return this.request('query', resource, request, options)
  }

  async mutate<Request, Response>(
    resource: FabricResourceDefinition<Request, Response, never>,
    request: Request,
    options: FabricResourceRequestOptions = {},
  ): Promise<Response> {
    return this.request('mutate', resource, request, options)
  }

  watch<Request, Event>(
    resource: FabricResourceDefinition<Request, unknown, Event> & { readonly event: NonNullable<FabricResourceDefinition<Request, unknown, Event>['event']> },
    request: Request,
    options: FabricResourceWatchOptions = {},
  ): EventStream<Event> {
    const parsedRequest = resource.request.parse(request)
    const url = resourceInputUrl(
      resourceUrl(resource.owner, resource.id, 'stream'),
      resource.version,
      parsedRequest,
    )
    const stream = createEventStream<Event>({
      url,
      parse: event => resource.event.parse(JSON.parse(event.data)),
      ...(options.minRetryMs === undefined ? {} : { minRetryMs: options.minRetryMs }),
      ...(options.maxRetryMs === undefined ? {} : { maxRetryMs: options.maxRetryMs }),
    })
    this.owner?.onDispose(() => { stream.dispose() })
    if (options.signal !== undefined) {
      if (options.signal.aborted) stream.dispose()
      else options.signal.addEventListener('abort', () => { stream.dispose() }, { once: true })
    }
    return stream
  }

  private async request<Request, Response>(
    operation: 'query' | 'mutate',
    resource: FabricResourceDefinition<Request, Response, never>,
    request: Request,
    options: FabricResourceRequestOptions,
  ): Promise<Response> {
    const parsedRequest = resource.request.parse(request)
    const owned = ownedSignal(this.owner?.signal, options.signal)
    try {
      const query = new URLSearchParams({ version: resource.version })
      const response = await fetch(`${resourceUrl(resource.owner, resource.id, operation)}?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsedRequest),
        ...(owned.signal === undefined ? {} : { signal: owned.signal }),
      })
      const payload = await parseResponse(response) as { data?: unknown }
      return resource.response.parse(payload.data)
    } finally {
      owned.dispose()
    }
  }
}

export function disposeResourceStream(stream: { dispose(): void }): () => void {
  return () => { stream.dispose() }
}
