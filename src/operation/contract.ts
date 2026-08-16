import { ObservableStore } from '../sdk/observable.ts'
import { defineCodec, type FabricCodec } from '../resource/contract.ts'

export const FABRIC_OPERATION_PREFIX = '/fabric/operation'

export interface FabricOperationWireSnapshot {
  readonly id: string
  readonly owner: string
  readonly operationId: string
  readonly version: string
  readonly status: string
  readonly progress: unknown
  readonly result: unknown
  readonly error: { readonly name: string; readonly message: string } | undefined
  readonly revision: number
}

export interface FabricOperationDefinition<Input, Result, Progress = never> {
  readonly owner: string
  readonly id: string
  readonly version: string
  readonly input: FabricCodec<Input>
  readonly result: FabricCodec<Result>
  readonly progress?: FabricCodec<Progress>
}

export function defineOperation<Input, Result, Progress = never>(
  definition: FabricOperationDefinition<Input, Result, Progress>,
): FabricOperationDefinition<Input, Result, Progress> {
  if (definition.owner.trim() === '') throw new Error('fabric operation owner is empty')
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(definition.id)) {
    throw new Error(`fabric operation id "${definition.id}" is invalid`)
  }
  if (definition.version.trim() === '') throw new Error(`fabric operation "${definition.owner}/${definition.id}" version is empty`)
  return Object.freeze({ ...definition })
}

export type FabricOperationStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface FabricOperationSnapshot<Result, Progress = never> {
  readonly id: string
  readonly owner: string
  readonly operationId: string
  readonly version: string
  readonly status: FabricOperationStatus
  readonly progress: Progress | undefined
  readonly result: Result | undefined
  readonly error: Error | undefined
  readonly revision: number
}

export interface FabricOperationHandle<Result, Progress = never> {
  readonly id: string
  getSnapshot(): FabricOperationSnapshot<Result, Progress>
  subscribe(listener: () => void): () => void
  cancel(): void
  result(): Promise<Result>
}

export interface FabricOperationRunContext<Progress> {
  readonly signal: AbortSignal
  report(progress: Progress): void
}

export type FabricOperationHandler<Input, Result, Progress = never> = (
  input: Input,
  context: FabricOperationRunContext<Progress>,
) => Result | Promise<Result>

export interface FabricPluginOperationHost {
  provide<Input, Result, Progress>(
    operation: FabricOperationDefinition<Input, Result, Progress>,
    handler: FabricOperationHandler<Input, Result, Progress>,
  ): () => void
}

export interface FabricOperationHost extends FabricPluginOperationHost {
  start<Input, Result, Progress>(
    operation: FabricOperationDefinition<Input, Result, Progress>,
    input: Input,
  ): FabricOperationHandle<Result, Progress>
}

interface OperationRecord<Result, Progress> {
  readonly definition: FabricOperationDefinition<unknown, Result, Progress>
  readonly controller: AbortController
  readonly handle: OperationHandle<Result, Progress>
}

class OperationHandle<Result, Progress> extends ObservableStore<FabricOperationSnapshot<Result, Progress>> implements FabricOperationHandle<Result, Progress> {
  private snapshot: FabricOperationSnapshot<Result, Progress>
  private settled!: Promise<Result>
  private resolveResult!: (value: Result) => void
  private rejectResult!: (error: unknown) => void

  constructor(
    readonly id: string,
    private readonly controller: AbortController,
    owner: string,
    operationId: string,
    version: string,
  ) {
    super()
    this.snapshot = Object.freeze({
      id,
      owner,
      operationId,
      version,
      status: 'running',
      progress: undefined,
      result: undefined,
      error: undefined,
      revision: 0,
    })
    this.settled = new Promise<Result>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    void this.settled.catch(() => undefined)
  }

  getSnapshot(): FabricOperationSnapshot<Result, Progress> {
    return this.snapshot
  }

  cancel(): void {
    if (this.snapshot.status !== 'running') return
    this.controller.abort()
  }

  result(): Promise<Result> {
    return this.settled
  }

  report(progress: Progress): void {
    if (this.snapshot.status !== 'running') return
    this.setSnapshot({ progress })
  }

  succeed(value: Result): void {
    if (this.snapshot.status !== 'running') return
    this.setSnapshot({ status: 'succeeded', result: value, error: undefined })
    this.resolveResult(value)
    this.clearSubscribers()
  }

  fail(error: Error): void {
    if (this.snapshot.status !== 'running') return
    this.setSnapshot({ status: 'failed', error, result: undefined })
    this.rejectResult(error)
    this.clearSubscribers()
  }

  cancelled(): void {
    if (this.snapshot.status !== 'running') return
    const error = new DOMException('operation cancelled', 'AbortError')
    this.setSnapshot({ status: 'cancelled', error, result: undefined })
    this.rejectResult(error)
    this.clearSubscribers()
  }

  private setSnapshot(patch: Partial<Omit<FabricOperationSnapshot<Result, Progress>, 'revision'>>): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    })
    this.publish()
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function operationKey(owner: string, id: string, version: string): string {
  return `${owner}:${id}:${version}`
}

/**
 * Host-side operation registry. It intentionally owns only in-memory runs;
 * persistence and cross-client observation are transport concerns layered on
 * top of this contract.
 */
export class FabricOperationRegistry implements FabricOperationHost {
  private readonly providers = new Map<string, {
    readonly owner: string
    readonly operation: FabricOperationDefinition<unknown, unknown, unknown>
    readonly handler: FabricOperationHandler<unknown, unknown, unknown>
    readonly runs: Set<OperationHandle<unknown, unknown>>
  }>()
  private readonly runs = new Map<string, OperationHandle<unknown, unknown>>()
  private sequence = 0

  provide<Input, Result, Progress>(
    operation: FabricOperationDefinition<Input, Result, Progress>,
    handler: FabricOperationHandler<Input, Result, Progress>,
  ): () => void {
    const definition = defineOperation(operation)
    const key = operationKey(definition.owner, definition.id, definition.version)
    if (this.providers.has(key)) throw new Error(`fabric operation "${key}" is already provided`)
    const record = {
      owner: definition.owner,
      operation: definition as FabricOperationDefinition<unknown, unknown, unknown>,
      handler: handler as FabricOperationHandler<unknown, unknown, unknown>,
      runs: new Set<OperationHandle<unknown, unknown>>(),
    }
    this.providers.set(key, record)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.providers.get(key) !== record) return
      this.providers.delete(key)
      for (const run of record.runs) run.cancel()
      record.runs.clear()
    }
  }

  start<Input, Result, Progress>(
    operation: FabricOperationDefinition<Input, Result, Progress>,
    input: Input,
  ): FabricOperationHandle<Result, Progress> {
    const definition = defineOperation(operation)
    const key = operationKey(definition.owner, definition.id, definition.version)
    const provider = this.providers.get(key)
    if (provider === undefined) throw new Error(`fabric operation "${key}" is unavailable`)
    const parsedInput = definition.input.parse(input)
    const controller = new AbortController()
    const run = new OperationHandle<Result, Progress>(
      `${definition.owner}/${definition.id}/${++this.sequence}`,
      controller,
      definition.owner,
      definition.id,
      definition.version,
    )
    provider.runs.add(run as OperationHandle<unknown, unknown>)
    this.runs.set(run.id, run as OperationHandle<unknown, unknown>)
    const report = (progress: Progress): void => {
      if (definition.progress !== undefined) run.report(definition.progress.parse(progress))
      else run.report(progress)
    }
    const context: FabricOperationRunContext<Progress> = { signal: controller.signal, report }
    void Promise.resolve()
      .then(() => provider.handler(parsedInput, context) as Promise<Result> | Result)
      .then(value => {
        if (controller.signal.aborted) run.cancelled()
        else run.succeed(definition.result.parse(value))
      })
      .catch(error => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) run.cancelled()
        else run.fail(asError(error))
      })
      .finally(() => { provider.runs.delete(run as OperationHandle<unknown, unknown>) })
    return run
  }

  startByIdentity(owner: string, id: string, version: string, input: unknown): FabricOperationHandle<unknown, unknown> {
    const provider = this.providers.get(operationKey(owner, id, version))
    if (provider === undefined) throw new Error(`fabric operation "${owner}:${id}:${version}" is unavailable`)
    return this.start(provider.operation, input)
  }

  getRun(id: string): FabricOperationHandle<unknown, unknown> | undefined {
    return this.runs.get(id)
  }

  dispose(): void {
    for (const provider of this.providers.values()) {
      for (const run of provider.runs) run.cancel()
      provider.runs.clear()
    }
    this.providers.clear()
    this.runs.clear()
  }
}

export const operationProgressCodec = defineCodec<unknown>(value => value)
