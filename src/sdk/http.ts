/** JSON values accepted by the default request body encoder. */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export interface FabricHttpErrorOptions {
  status: number
  statusText: string
  url: string
  code?: string
  details?: unknown
}

/** Structured non-2xx response from a Fabric JSON endpoint. */
export class FabricHttpError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string
  readonly code: string | undefined
  readonly details: unknown

  constructor(message: string, options: FabricHttpErrorOptions) {
    super(message)
    this.name = 'FabricHttpError'
    this.status = options.status
    this.statusText = options.statusText
    this.url = options.url
    this.code = options.code
    this.details = options.details
  }
}

/** Runtime inputs used by {@link createJsonClient}. */
export interface JsonClientOptions {
  /** Same-origin base URL. Relative bases resolve against the current document. */
  baseUrl?: string
  /** Current DSH session. When present it is added as a query parameter. */
  sessionId?: () => string | undefined
  sessionParam?: string
  headers?: HeadersInit | (() => HeadersInit)
  fetch?: typeof globalThis.fetch
}

export interface JsonRequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | JsonValue | undefined
  /** Skip automatic session query injection for global endpoints. */
  session?: boolean
}

export interface JsonClient {
  request<T>(path: string, options?: JsonRequestOptions): Promise<T>
  get<T>(path: string, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  post<T>(path: string, body?: JsonValue, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  put<T>(path: string, body?: JsonValue, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  patch<T>(path: string, body?: JsonValue, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  delete<T>(path: string, options?: Omit<JsonRequestOptions, 'method' | 'body'>): Promise<T>
  url(path: string, options?: { session?: boolean }): string
}

function baseHref(): string {
  if (typeof document !== 'undefined') return document.baseURI
  return 'http://localhost/'
}

function resolveBase(baseUrl: string | undefined): URL {
  return new URL(baseUrl ?? '/', baseHref())
}

function messageFromPayload(payload: unknown, fallback: string): string {
  if (payload !== null && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

function codeFromPayload(payload: unknown): string | undefined {
  if (payload !== null && typeof payload === 'object' && 'code' in payload) {
    const code = (payload as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return undefined
}

async function decodeResponse(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined
  const text = await response.text()
  if (text === '') return undefined
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) return text
  try {
    return JSON.parse(text) as unknown
  } catch (cause) {
    throw new Error(`invalid JSON response from ${response.url}`, { cause })
  }
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === 'string'
    || value instanceof Blob
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || value instanceof FormData
    || value instanceof URLSearchParams
    || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
}

/** Create a same-origin JSON client suited to small DSH plugin HTTP APIs. */
export function createJsonClient(options: JsonClientOptions = {}): JsonClient {
  const fetcher = options.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new Error('Fabric JSON client requires fetch')
  const base = resolveBase(options.baseUrl)
  const sessionParam = options.sessionParam ?? 'sessionId'

  const url = (path: string, request: { session?: boolean } = {}): string => {
    const resolved = new URL(path, base)
    if (request.session !== false) {
      const sessionId = options.sessionId?.()
      if (sessionId !== undefined && sessionId !== '') resolved.searchParams.set(sessionParam, sessionId)
    }
    return resolved.toString()
  }

  const request = async <T>(path: string, requestOptions: JsonRequestOptions = {}): Promise<T> => {
    const { body: requestBody, session, ...init } = requestOptions
    const headers = new Headers(typeof options.headers === 'function' ? options.headers() : options.headers)
    new Headers(init.headers).forEach((value, key) => { headers.set(key, value) })
    let body = requestBody
    if (body !== undefined && !isBodyInit(body)) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(body)
    }
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    const response = await fetcher(url(path, session === undefined ? {} : { session }), {
      ...init,
      headers,
      ...(body === undefined ? {} : { body }),
    })
    const payload = await decodeResponse(response)
    if (!response.ok) {
      const code = codeFromPayload(payload)
      throw new FabricHttpError(
        messageFromPayload(payload, `${response.status} ${response.statusText}`.trim()),
        {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          details: payload,
          ...(code === undefined ? {} : { code }),
        },
      )
    }
    return payload as T
  }

  return {
    request,
    get: (path, requestOptions = {}) => request(path, { ...requestOptions, method: 'GET' }),
    post: (path, body, requestOptions = {}) => request(path, {
      ...requestOptions,
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    }),
    put: (path, body, requestOptions = {}) => request(path, {
      ...requestOptions,
      method: 'PUT',
      ...(body === undefined ? {} : { body }),
    }),
    patch: (path, body, requestOptions = {}) => request(path, {
      ...requestOptions,
      method: 'PATCH',
      ...(body === undefined ? {} : { body }),
    }),
    delete: (path, requestOptions = {}) => request(path, { ...requestOptions, method: 'DELETE' }),
    url,
  }
}
