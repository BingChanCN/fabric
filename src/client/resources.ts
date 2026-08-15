import { createEventStream, type EventStream } from '../sdk/sse.ts'
import type {
  FabricResourceClient, FabricResourceDefinition, FabricResourceRequestOptions,
  FabricResourceWatchOptions, FabricSessionRef,
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

function resourceInputUrl(url: string, input: unknown, session: FabricSessionRef | undefined): string {
  const query = new URLSearchParams()
  if (input !== undefined) query.set('input', JSON.stringify(input))
  if (session !== undefined) query.set('sessionId', session.id)
  const encoded = query.toString()
  return encoded === '' ? url : `${url}?${encoded}`
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

function validateScope(resource: FabricResourceDefinition<unknown, unknown, unknown>, session: FabricSessionRef | undefined): void {
  if (resource.scope === 'session' && session === undefined) {
    throw new FabricResourceError({ code: 'session-required', message: `fabric resource "${resource.id}" requires an explicit session` })
  }
  if (resource.scope === 'profile' && session !== undefined) {
    throw new FabricResourceError({ code: 'session-not-allowed', message: `fabric resource "${resource.id}" is profile-scoped` })
  }
}

function sessionQuery(session: FabricSessionRef | undefined): string {
  if (session === undefined) return ''
  return `?sessionId=${encodeURIComponent(session.id)}`
}

/** Browser transport for the profile's single Fabric resource dispatcher. */
export class FabricResourceClientService implements FabricResourceClient {
  constructor(
    private readonly pluginId: string,
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
    validateScope(resource, options.session)
    const parsedRequest = resource.request.parse(request)
    const url = resourceInputUrl(
      resourceUrl(this.pluginId, resource.id, 'stream'),
      parsedRequest,
      options.session,
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
    validateScope(resource, options.session)
    const parsedRequest = resource.request.parse(request)
    const owned = ownedSignal(this.owner?.signal, options.signal)
    try {
      const response = await fetch(`${resourceUrl(this.pluginId, resource.id, operation)}${sessionQuery(options.session)}`, {
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
