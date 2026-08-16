import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FabricRuntimeHostManager } from '../runtime/host-manager.ts'
import type { FabricInventoryEntry } from '../runtime/inventory.ts'
import type { FabricPackageStore } from './package-store.ts'
import type { FabricRuntimeClientRegistry } from './runtime-clients.ts'

export const FABRIC_DEV_PREFIX = '/fabric/dev'

interface DevSession {
  readonly leaseId: string
  readonly generation: number
  readonly packageName: string
  readonly entry: FabricInventoryEntry
  expiresAt: number
}

interface DevApplyInput {
  readonly leaseId: string
  readonly generation: number
  readonly source: string
}

interface DevLeaseInput {
  readonly leaseId: string
  readonly packageName: string
}

const LEASE = /^[A-Za-z0-9._-]{1,128}$/u

function parseRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Fabric dev request must be an object')
  return value as Record<string, unknown>
}

function parseApply(value: unknown): DevApplyInput {
  const item = parseRecord(value)
  if (typeof item.leaseId !== 'string' || !LEASE.test(item.leaseId)) throw new Error('Fabric dev leaseId is invalid')
  if (typeof item.generation !== 'number' || !Number.isSafeInteger(item.generation) || item.generation < 1) {
    throw new Error('Fabric dev generation is invalid')
  }
  if (typeof item.source !== 'string' || item.source.trim() === '' || item.source.length > 4096) {
    throw new Error('Fabric dev source is invalid')
  }
  return { leaseId: item.leaseId, generation: item.generation, source: item.source }
}

function parseLease(value: unknown): DevLeaseInput {
  const item = parseRecord(value)
  if (typeof item.leaseId !== 'string' || !LEASE.test(item.leaseId)) throw new Error('Fabric dev leaseId is invalid')
  if (typeof item.packageName !== 'string' || item.packageName.trim() === '') throw new Error('Fabric dev packageName is invalid')
  return { leaseId: item.leaseId, packageName: item.packageName }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 64 * 1024) throw new Error('Fabric dev request is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** In-memory development overlays. Production desired state is never mutated. */
export class FabricDevRuntimeManager {
  private readonly sessions = new Map<string, DevSession>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly retiredLeases = new Set<string>()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    private readonly store: FabricPackageStore,
    private readonly hosts: FabricRuntimeHostManager,
    private readonly clients: FabricRuntimeClientRegistry,
    private readonly fabricApiVersion: string,
    private readonly ready: Promise<void> = Promise.resolve(),
    private readonly leaseTimeoutMs = 10_000,
  ) {
    this.timer = setInterval(() => { void this.expireLeases() }, Math.max(500, Math.floor(leaseTimeoutMs / 4)))
    this.timer.unref?.()
  }

  isActive(packageName: string): boolean {
    return this.sessions.has(packageName)
  }

  async acquireExclusive(packageName: string): Promise<() => void> {
    await this.ready
    return this.acquire(packageName)
  }

  async runExclusive<T>(packageName: string, action: () => Promise<T>): Promise<T> {
    await this.ready
    return this.serial(packageName, action)
  }

  async apply(input: DevApplyInput): Promise<{ packageName: string; version: string; generation: number }> {
    await this.ready
    this.assertLease(input.leaseId)
    const admitted = await this.store.admitDevDirectory(input.source, input.leaseId, input.generation, {
      fabricApiVersion: this.fabricApiVersion,
    })
    const packageName = admitted.manifest.name
    let retained = false
    try {
      return await this.serial(packageName, async () => {
        this.assertLease(input.leaseId)
        const current = this.sessions.get(packageName)
        if (current !== undefined && current.leaseId !== input.leaseId) {
          throw new Error(`Fabric dev package "${packageName}" already has an active lease`)
        }
        if (current !== undefined && input.generation <= current.generation) {
          throw new Error(`Fabric dev generation for "${packageName}" must increase`)
        }
        const production = (await this.store.inventory.read()).plugins[packageName]
        const fallback = current?.entry ?? production
        const releaseClients = current !== undefined || production?.enabled === true
          ? await this.retract(packageName)
          : undefined
        const entry: FabricInventoryEntry = {
          version: admitted.manifest.version,
          source: admitted.source,
          enabled: true,
        }
        const session: DevSession = {
          leaseId: input.leaseId,
          generation: input.generation,
          packageName,
          entry,
          expiresAt: Date.now() + this.leaseTimeoutMs,
        }
        try {
          await this.hosts.activateCandidate(packageName, entry, fallback, () => {
            this.sessions.set(packageName, session)
            this.hosts.setClientOverrides(this.overrides())
            retained = true
          })
        } catch (error) {
          await this.publishAfter(releaseClients)
          throw error
        }
        await this.publishAfter(releaseClients)
        if (current !== undefined) await this.store.releaseDevPackage(current.entry.source)
        return { packageName, version: entry.version, generation: input.generation }
      })
    } catch (error) {
      if (!retained) await this.store.releaseDevPackage(admitted.source)
      throw error
    }
  }

  async heartbeat(input: DevLeaseInput): Promise<void> {
    await this.ready
    const session = this.sessions.get(input.packageName)
    if (session === undefined || session.leaseId !== input.leaseId) throw new Error('Fabric dev lease is not active')
    session.expiresAt = Date.now() + this.leaseTimeoutMs
  }

  async stop(input: DevLeaseInput): Promise<void> {
    await this.ready
    this.retiredLeases.add(input.leaseId)
    await this.serial(input.packageName, async () => {
      const current = this.sessions.get(input.packageName)
      if (current === undefined) return
      if (current.leaseId !== input.leaseId) throw new Error('Fabric dev lease does not own this package')
      await this.stopSession(current, false)
    })
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer)
    await Promise.all([...this.queues.values()])
    this.sessions.clear()
    await this.store.cleanDevPackages()
  }

  private overrides(): Record<string, FabricInventoryEntry> {
    return Object.fromEntries([...this.sessions].map(([name, session]) => [name, session.entry]))
  }

  private async publish(): Promise<void> {
    this.hosts.setClientOverrides(this.overrides())
    await this.hosts.publishClientInventory()
  }

  private async publishAfter(release: (() => Promise<void>) | undefined): Promise<void> {
    if (release === undefined) await this.publish()
    else await release()
  }

  private async retract(packageName: string, force = false): Promise<() => Promise<void>> {
    this.hosts.setClientOverrides(this.overrides())
    const snapshot = await this.hosts.beginClientRetraction(packageName)
    try {
      await this.clients.waitForInactive(packageName, `${snapshot.revision}`)
    } catch (error) {
      if (!force) {
        await this.hosts.endClientRetraction(packageName)
        throw error
      }
    }
    let active = true
    return async () => {
      if (!active) return
      active = false
      await this.hosts.endClientRetraction(packageName)
    }
  }

  private async stopSession(current: DevSession, force: boolean): Promise<void> {
    const releaseClients = await this.retract(current.packageName, force)
    this.sessions.delete(current.packageName)
    this.hosts.setClientOverrides(this.overrides())
    try {
      await this.hosts.reconcileNow()
    } finally {
      try {
        await releaseClients()
      } finally {
        await this.store.releaseDevPackage(current.entry.source)
      }
    }
  }

  private async acquire(packageName: string): Promise<() => void> {
    const before = this.queues.get(packageName) ?? Promise.resolve()
    let releaseGate!: () => void
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    const held = before.then(() => gate, () => gate)
    this.queues.set(packageName, held)
    void held.finally(() => {
      if (this.queues.get(packageName) === held) this.queues.delete(packageName)
    })
    await before.catch(() => {})
    let released = false
    return () => {
      if (released) return
      released = true
      releaseGate()
    }
  }

  private async serial<T>(packageName: string, action: () => Promise<T>): Promise<T> {
    const release = await this.acquire(packageName)
    try {
      return await action()
    } finally {
      release()
    }
  }

  private assertLease(leaseId: string): void {
    if (this.retiredLeases.has(leaseId)) throw new Error('Fabric dev lease is not active')
  }

  private async expireLeases(): Promise<void> {
    const expired = [...this.sessions.values()].filter(session => session.expiresAt <= Date.now())
    await Promise.all(expired.map(session => {
      this.retiredLeases.add(session.leaseId)
      return this.serial(session.packageName, async () => {
        const current = this.sessions.get(session.packageName)
        if (current !== session) return
        await this.stopSession(current, true)
      }).catch(() => {})
    }))
  }
}

export function fabricDevRouteHandler(manager: FabricDevRuntimeManager) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
      res.end()
      return
    }
    const path = new URL(req.url ?? FABRIC_DEV_PREFIX, 'http://localhost').pathname
    const action = path.startsWith(`${FABRIC_DEV_PREFIX}/`) ? path.slice(FABRIC_DEV_PREFIX.length + 1) : ''
    try {
      if (action === 'apply') {
        writeJson(res, 200, await manager.apply(parseApply(await readJson(req))))
        return
      }
      if (action === 'heartbeat') {
        await manager.heartbeat(parseLease(await readJson(req)))
        writeJson(res, 200, { ok: true })
        return
      }
      if (action === 'stop') {
        await manager.stop(parseLease(await readJson(req)))
        writeJson(res, 200, { ok: true })
        return
      }
      writeJson(res, 404, { error: { code: 'fabric-dev-route-not-found', message: 'Fabric dev route not found' } })
    } catch (error) {
      writeJson(res, 400, { error: { code: 'fabric-dev-failed', message: error instanceof Error ? error.message : String(error) } })
    }
  }
}
