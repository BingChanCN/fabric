import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FABRIC_RUNTIME_DISCOVERY_FILE, parseFabricRuntimeDiscovery, writeFabricRuntimeDiscovery,
} from '../src/runtime/discovery.ts'

const roots: string[] = []
afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'fabric-discovery-'))
  roots.push(value)
  return value
}

describe('Fabric Runtime discovery', () => {
  it('writes an atomic loopback endpoint and removes only its own record', async () => {
    const profile = await root()
    const dispose = await writeFabricRuntimeDiscovery(profile, 4_321, '1.0.0')
    const path = join(profile, FABRIC_RUNTIME_DISCOVERY_FILE)
    const value = parseFabricRuntimeDiscovery(JSON.parse(await readFile(path, 'utf8')) as unknown)
    expect(value).toMatchObject({ format: 1, pid: process.pid, version: '1.0.0', baseUrl: 'http://127.0.0.1:4321' })

    await dispose()
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects non-loopback discovery input', () => {
    expect(() => parseFabricRuntimeDiscovery({
      format: 1,
      pid: 1,
      version: '1.0.0',
      baseUrl: 'http://0.0.0.0:3000',
      startedAt: new Date().toISOString(),
    })).toThrow('baseUrl')
  })
})
