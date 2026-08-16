import {
  FABRIC_OPERATION_PREFIX,
  type FabricOperationDefinition, type FabricOperationHandle, type FabricOperationSnapshot,
} from '../operation/contract.ts'

interface FetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

interface OperationEventSource {
  onmessage: ((event: { readonly data: string }) => void) | null
  onerror: (() => void) | null
  close(): void
}

export interface FabricOperationClientOptions {
  readonly fetch?: (input: string, init?: RequestInit) => Promise<FetchResponse>
  readonly createEventSource?: (url: string) => OperationEventSource
}

export interface FabricClientOperationHost {
  start<Input, Result, Progress>(
    operation: FabricOperationDefinition<Input, Result, Progress>,
    input: Input,
  ): Promise<FabricRemoteOperationHandle<Result, Progress>>
  attach<Result, Progress>(
    operation: FabricOperationDefinition<unknown, Result, Progress>,
    runId: string,
  ): Promise<FabricRemoteOperationHandle<Result, Progress>>
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('operation response is malformed')
  return value as Record<string, unknown>
}

function responseError(value: unknown, status: number): Error {
  try {
    const root = object(value)
    const error = object(root.error)
    return new Error(typeof error.message === 'string' ? error.message : `operation request failed (${status})`)
  } catch {
    return new Error(`operation request failed (${status})`)
  }
}

function decodeSnapshot<Result, Progress>(
  definition: FabricOperationDefinition<unknown, Result, Progress>,
  raw: unknown,
): FabricOperationSnapshot<Result, Progress> {
  const value = object(raw)
  if (typeof value.id !== 'string' || value.owner !== definition.owner || value.operationId !== definition.id
    || value.version !== definition.version || typeof value.revision !== 'number'
    || !['running', 'succeeded', 'failed', 'cancelled'].includes(String(value.status))) {
    throw new Error('operation snapshot identity is invalid')
  }
  const status = value.status as FabricOperationSnapshot<Result, Progress>['status']
  const progress = value.progress === undefined || definition.progress === undefined
    ? undefined
    : definition.progress.parse(value.progress)
  const result = status === 'succeeded' ? definition.result.parse(value.result) : undefined
  const rawError = value.error === undefined ? undefined : object(value.error)
  const error = rawError === undefined ? undefined : Object.assign(
    new Error(typeof rawError.message === 'string' ? rawError.message : 'operation failed'),
    { name: typeof rawError.name === 'string' ? rawError.name : 'Error' },
  )
  return Object.freeze({
    id: value.id,
    owner: definition.owner,
    operationId: definition.id,
    version: definition.version,
    status,
    progress,
    result,
    error,
    revision: value.revision,
  })
}

export class FabricRemoteOperationHandle<Result, Progress = never> implements FabricOperationHandle<Result, Progress> {
  readonly id: string
  private readonly listeners = new Set<() => void>()
  private snapshot: FabricOperationSnapshot<Result, Progress>
  private source: OperationEventSource | undefined
  private settled: Promise<Result>
  private resolveResult!: (value: Result) => void
  private rejectResult!: (error: unknown) => void

  constructor(
    private readonly definition: FabricOperationDefinition<unknown, Result, Progress>,
    initial: FabricOperationSnapshot<Result, Progress>,
    private readonly fetch: (input: string, init?: RequestInit) => Promise<FetchResponse>,
    createEventSource: (url: string) => OperationEventSource,
  ) {
    this.id = initial.id
    this.snapshot = initial
    this.settled = new Promise<Result>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    void this.settled.catch(() => undefined)
    this.settle(initial)
    if (initial.status === 'running') {
      const source = createEventSource(`${FABRIC_OPERATION_PREFIX}/runs/${encodeURIComponent(this.id)}/events`)
      this.source = source
      source.onmessage = event => {
        try {
          const next = decodeSnapshot(this.definition, JSON.parse(event.data) as unknown)
          if (next.revision < this.snapshot.revision) return
          this.snapshot = next
          for (const listener of [...this.listeners]) listener()
          this.settle(next)
        } catch {
          // A malformed event cannot mutate the last verified snapshot.
        }
      }
    }
  }

  getSnapshot(): FabricOperationSnapshot<Result, Progress> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  cancel(): void {
    if (this.snapshot.status !== 'running') return
    void this.fetch(`${FABRIC_OPERATION_PREFIX}/runs/${encodeURIComponent(this.id)}/cancel`, { method: 'POST' })
  }

  result(): Promise<Result> {
    return this.settled
  }

  dispose(): void {
    this.source?.close()
    this.source = undefined
    this.listeners.clear()
  }

  private settle(snapshot: FabricOperationSnapshot<Result, Progress>): void {
    if (snapshot.status === 'running') return
    this.source?.close()
    this.source = undefined
    if (snapshot.status === 'succeeded') this.resolveResult(snapshot.result as Result)
    else this.rejectResult(snapshot.error ?? new Error(`operation ${snapshot.status}`))
  }
}

export class FabricOperationClient implements FabricClientOperationHost {
  private readonly fetch: (input: string, init?: RequestInit) => Promise<FetchResponse>
  private readonly createEventSource: (url: string) => OperationEventSource

  constructor(options: FabricOperationClientOptions = {}) {
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.createEventSource = options.createEventSource ?? (url => new EventSource(url) as unknown as OperationEventSource)
  }

  async start<Input, Result, Progress>(
    operation: FabricOperationDefinition<Input, Result, Progress>,
    input: Input,
  ): Promise<FabricRemoteOperationHandle<Result, Progress>> {
    const response = await this.fetch(
      `${FABRIC_OPERATION_PREFIX}/start/${encodeURIComponent(operation.owner)}/${encodeURIComponent(operation.id)}?version=${encodeURIComponent(operation.version)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(operation.input.parse(input)),
      },
    )
    const body = await response.json()
    if (!response.ok) throw responseError(body, response.status)
    return this.createHandle(operation, object(body).run)
  }

  async attach<Result, Progress>(
    operation: FabricOperationDefinition<unknown, Result, Progress>,
    runId: string,
  ): Promise<FabricRemoteOperationHandle<Result, Progress>> {
    const response = await this.fetch(`${FABRIC_OPERATION_PREFIX}/runs/${encodeURIComponent(runId)}`)
    const body = await response.json()
    if (!response.ok) throw responseError(body, response.status)
    return this.createHandle(operation, object(body).run)
  }

  private createHandle<Result, Progress>(
    operation: FabricOperationDefinition<unknown, Result, Progress>,
    raw: unknown,
  ): FabricRemoteOperationHandle<Result, Progress> {
    return new FabricRemoteOperationHandle(operation, decodeSnapshot(operation, raw), this.fetch, this.createEventSource)
  }
}
