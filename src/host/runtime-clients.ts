import type { IncomingMessage, ServerResponse } from 'node:http'
import { isFabricPackageName } from '../runtime/manifest.ts'

export const FABRIC_RUNTIME_CLIENT_STATUS_PATH = '/fabric/runtime/clients/status'

export type FabricRuntimeClientReportedStatus = 'loading' | 'active' | 'inactive' | 'failed'

export interface FabricRuntimeClientReport {
  readonly clientId: string
  readonly packageName: string
  readonly version: string
  readonly generation: string
  readonly status: FabricRuntimeClientReportedStatus
  readonly error?: string
}

interface ClientRecord {
  connections: number
  readonly packages: Map<string, FabricRuntimeClientReport>
}

interface InactiveWaiter {
  readonly packageName: string
  readonly generation: string
  readonly clientIds: Set<string>
  readonly resolve: () => void
}

const CLIENT_ID = /^[A-Za-z0-9._-]{1,128}$/u
const GENERATION = /^[A-Za-z0-9._:-]{1,128}$/u
const STATUSES = new Set<FabricRuntimeClientReportedStatus>(['loading', 'active', 'inactive', 'failed'])

function parseReport(value: unknown): FabricRuntimeClientReport {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('runtime client report must be an object')
  const item = value as Record<string, unknown>
  if (typeof item.clientId !== 'string' || !CLIENT_ID.test(item.clientId)) throw new Error('runtime clientId is invalid')
  if (typeof item.packageName !== 'string' || !isFabricPackageName(item.packageName)) throw new Error('runtime package name is invalid')
  if (typeof item.version !== 'string' || item.version.length === 0 || item.version.length > 128) throw new Error('runtime version is invalid')
  if (typeof item.generation !== 'string' || !GENERATION.test(item.generation)) throw new Error('runtime generation is invalid')
  if (typeof item.status !== 'string' || !STATUSES.has(item.status as FabricRuntimeClientReportedStatus)) {
    throw new Error('runtime client status is invalid')
  }
  if (item.error !== undefined && (typeof item.error !== 'string' || item.error.length > 2000)) {
    throw new Error('runtime client error is invalid')
  }
  return {
    clientId: item.clientId,
    packageName: item.packageName,
    version: item.version,
    generation: item.generation,
    status: item.status as FabricRuntimeClientReportedStatus,
    ...(typeof item.error === 'string' ? { error: item.error } : {}),
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Operation aborted', 'AbortError')
}

function generationAtLeast(actual: string, expected: string): boolean {
  if (actual === expected) return true
  if (!/^\d+$/u.test(actual) || !/^\d+$/u.test(expected)) return false
  return BigInt(actual) >= BigInt(expected)
}

/** Tracks only currently connected browser tabs and their Runtime Package generations. */
export class FabricRuntimeClientRegistry {
  private readonly clients = new Map<string, ClientRecord>()
  private readonly waiters = new Set<InactiveWaiter>()

  constructor(private readonly inactiveTimeoutMs = 10_000) {}

  connect(clientId: string): () => void {
    if (!CLIENT_ID.test(clientId)) throw new Error('runtime clientId is invalid')
    const client = this.clients.get(clientId) ?? { connections: 0, packages: new Map() }
    client.connections += 1
    this.clients.set(clientId, client)
    let connected = true
    return () => {
      if (!connected) return
      connected = false
      client.connections -= 1
      if (client.connections <= 0) this.clients.delete(clientId)
      this.flush()
    }
  }

  report(value: unknown): FabricRuntimeClientReport {
    const report = parseReport(value)
    const client = this.clients.get(report.clientId) ?? { connections: 0, packages: new Map() }
    client.packages.set(report.packageName, report)
    this.clients.set(report.clientId, client)
    this.flush()
    return report
  }

  waitForInactive(packageName: string, generation: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(abortError(signal))
    const clientIds = new Set(
      [...this.clients.entries()]
        .filter(([, client]) => client.connections > 0)
        .map(([clientId]) => clientId),
    )
    if (this.areInactive(packageName, generation, clientIds)) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      let waiter: InactiveWaiter
      let timer: ReturnType<typeof setTimeout>
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        this.waiters.delete(waiter)
        cleanup()
        reject(abortError(signal!))
      }
      const complete = (): void => {
        cleanup()
        resolve()
      }
      waiter = { packageName, generation, clientIds, resolve: complete }
      this.waiters.add(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        this.waiters.delete(waiter)
        cleanup()
        reject(new Error(`runtime clients did not retract "${packageName}" generation "${generation}"`))
      }, this.inactiveTimeoutMs)
      this.flush()
    })
  }

  private areInactive(packageName: string, generation: string, clientIds: ReadonlySet<string>): boolean {
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId)
      if (client === undefined || client.connections <= 0) continue
      const status = client.packages.get(packageName)
      if (status?.status !== 'inactive' || !generationAtLeast(status.generation, generation)) return false
    }
    return true
  }

  private flush(): void {
    for (const waiter of [...this.waiters]) {
      if (!this.areInactive(waiter.packageName, waiter.generation, waiter.clientIds)) continue
      this.waiters.delete(waiter)
      waiter.resolve()
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 32 * 1024) throw new Error('runtime client report is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export function runtimeClientStatusRouteHandler(registry: FabricRuntimeClientRegistry) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
      res.end()
      return
    }
    try {
      registry.report(await readJson(req))
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
    } catch (error) {
      const body = JSON.stringify({ error: { code: 'runtime-client-report-invalid', message: error instanceof Error ? error.message : String(error) } })
      res.writeHead(400, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      })
      res.end(body)
    }
  }
}
