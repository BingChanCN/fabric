import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const FABRIC_RUNTIME_DISCOVERY_FORMAT = 1 as const
export const FABRIC_RUNTIME_DISCOVERY_FILE = join('.fabric', 'runtime.json')

export interface FabricRuntimeDiscovery {
  readonly format: typeof FABRIC_RUNTIME_DISCOVERY_FORMAT
  readonly pid: number
  readonly version: string
  readonly baseUrl: string
  readonly startedAt: string
}

export function parseFabricRuntimeDiscovery(value: unknown): FabricRuntimeDiscovery {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Fabric runtime discovery must be an object')
  const item = value as Record<string, unknown>
  if (item.format !== FABRIC_RUNTIME_DISCOVERY_FORMAT) throw new Error('Fabric runtime discovery format is unsupported')
  if (typeof item.pid !== 'number' || !Number.isSafeInteger(item.pid) || item.pid <= 0) throw new Error('Fabric runtime discovery pid is invalid')
  if (typeof item.version !== 'string' || item.version === '') throw new Error('Fabric runtime discovery version is invalid')
  if (typeof item.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(item.baseUrl)) throw new Error('Fabric runtime discovery baseUrl is invalid')
  if (typeof item.startedAt !== 'string' || Number.isNaN(Date.parse(item.startedAt))) throw new Error('Fabric runtime discovery startedAt is invalid')
  return item as unknown as FabricRuntimeDiscovery
}

export async function writeFabricRuntimeDiscovery(
  profileRoot: string,
  port: number,
  version: string,
): Promise<() => Promise<void>> {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('Fabric runtime discovery port is invalid')
  const path = join(profileRoot, FABRIC_RUNTIME_DISCOVERY_FILE)
  await mkdir(dirname(path), { recursive: true })
  const discovery: FabricRuntimeDiscovery = {
    format: FABRIC_RUNTIME_DISCOVERY_FORMAT,
    pid: process.pid,
    version,
    baseUrl: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(discovery, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
  return async () => {
    try {
      const current = parseFabricRuntimeDiscovery(JSON.parse(await readFile(path, 'utf8')) as unknown)
      if (current.pid === discovery.pid && current.startedAt === discovery.startedAt) await rm(path, { force: true })
    } catch {
      // A newer runtime or an already-removed file does not belong to this disposer.
    }
  }
}
