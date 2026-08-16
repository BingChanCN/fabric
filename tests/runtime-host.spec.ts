import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricResourceHostService } from '../src/host/resources.ts'
import { FabricInventoryStore, FabricPackageStore, LocalFabricPackageManager } from '../src/host/package-store.ts'
import { FabricRuntimeHostManager } from '../src/runtime/host-manager.ts'

const roots: string[] = []
const marker = '__fabricRuntimeHostTest'

declare global {
  // eslint-disable-next-line no-var
  var __fabricRuntimeHostTest: { starts: string[]; stops: string[] } | undefined
  // eslint-disable-next-line no-var
  var __fabricRuntimeHostGate: Promise<void> | undefined
}

async function makeHostPackage(
  version: string,
  fail = false,
  name = '@example/runtime-host',
  waitForGate = false,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fabric-runtime-host-'))
  roots.push(root)
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name,
    version,
    fabric: { format: 1, api: '^0.8.0', host: './lib/fabric-host.js' },
  }))
  await writeFile(join(root, 'lib', 'fabric-host.js'), [
    `const marker = globalThis.${marker} ??= { starts: [], stops: [] };`,
    'export default {',
    '  descriptor: { name: "Runtime Host" },',
    `  ${waitForGate ? 'async ' : ''}setup() {`,
    `    marker.starts.push(${JSON.stringify(version)});`,
    ...(waitForGate ? ['    await globalThis.__fabricRuntimeHostGate;'] : []),
    fail ? '    throw new Error("host setup failed");' : `    return () => { marker.stops.push(${JSON.stringify(version)}); };`,
    '  },',
    '};',
  ].join('\n'))
  return root
}

afterEach(async () => {
  globalThis.__fabricRuntimeHostTest = undefined
  globalThis.__fabricRuntimeHostGate = undefined
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('FabricRuntimeHostManager', () => {
  it('mounts enabled Host definitions and disposes their Cordis fibers', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-runtime-profile-'))
    roots.push(profile)
    const source = await makeHostPackage('1.0.0')
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const packages = new LocalFabricPackageManager(store, '0.8.2')
    await packages.install(source)

    const ctx = new Context()
    const resources = new FabricResourceHostService()
    ctx.provide('fabricHost', resources)
    const hosts = new FabricRuntimeHostManager(ctx, store)
    await hosts.start()

    expect(hosts.state('@example/runtime-host')).toMatchObject({ status: 'active', version: '1.0.0' })
    expect(globalThis.__fabricRuntimeHostTest?.starts).toEqual(['1.0.0'])
    await hosts.dispose()
    expect(globalThis.__fabricRuntimeHostTest?.stops).toEqual(['1.0.0'])
    await ctx.fiber.dispose()
  })

  it('serializes startup recovery with subscription-triggered reconciles', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-runtime-profile-'))
    roots.push(profile)
    const previous = await makeHostPackage('1.0.0')
    const failedCurrent = await makeHostPackage('2.0.0', true)
    const slowOther = await makeHostPackage('3.0.0', false, '@example/other-host', true)
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const packages = new LocalFabricPackageManager(store, '0.8.2')
    await packages.install(previous)
    await packages.install(failedCurrent)
    await packages.install(slowOther)

    let releaseGate!: () => void
    globalThis.__fabricRuntimeHostGate = new Promise<void>(resolve => { releaseGate = resolve })
    const ctx = new Context()
    ctx.provide('fabricHost', new FabricResourceHostService())
    const hosts = new FabricRuntimeHostManager(ctx, store)
    const starting = hosts.start()
    await vi.waitFor(() => expect(globalThis.__fabricRuntimeHostTest?.starts).toContain('3.0.0'))
    expect(globalThis.__fabricRuntimeHostTest?.starts.filter(version => version === '3.0.0')).toHaveLength(1)
    releaseGate()
    await starting

    expect(globalThis.__fabricRuntimeHostTest?.starts.filter(version => version === '3.0.0')).toHaveLength(1)
    expect(hosts.state('@example/runtime-host')).toMatchObject({ status: 'active', version: '1.0.0' })
    expect(hosts.state('@example/other-host')).toMatchObject({ status: 'active', version: '3.0.0' })

    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('restores the persisted previous version when a candidate Host setup fails', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-runtime-profile-'))
    roots.push(profile)
    const first = await makeHostPackage('1.0.0')
    const failed = await makeHostPackage('2.0.0', true)
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const packages = new LocalFabricPackageManager(store, '0.8.2')
    await packages.install(first)

    const ctx = new Context()
    const resources = new FabricResourceHostService()
    ctx.provide('fabricHost', resources)
    const hosts = new FabricRuntimeHostManager(ctx, store)
    await hosts.start()
    expect(store.inventory.readPublished().plugins['@example/runtime-host']).toMatchObject({ version: '1.0.0', enabled: true })
    await packages.install(failed)
    expect(store.inventory.readPublished().plugins['@example/runtime-host']).toMatchObject({ version: '1.0.0', enabled: true })

    await vi.waitFor(async () => {
      expect((await packages.inventory()).plugins['@example/runtime-host']).toMatchObject({
        version: '1.0.0',
        enabled: true,
        previous: { version: '2.0.0' },
      })
      expect(hosts.state('@example/runtime-host')).toMatchObject({ status: 'active', version: '1.0.0' })
    })
    expect(store.inventory.readPublished().plugins['@example/runtime-host']).toMatchObject({ version: '1.0.0', enabled: true })
    await expect(store.readManifest('@example/runtime-host', '2.0.0')).resolves.toMatchObject({ version: '2.0.0' })
    expect(globalThis.__fabricRuntimeHostTest?.starts).toEqual(['1.0.0', '2.0.0', '1.0.0'])
    expect(globalThis.__fabricRuntimeHostTest?.stops).toEqual(['1.0.0'])

    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps concurrent Client retractions composed across full snapshot publications', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-runtime-profile-'))
    roots.push(profile)
    const first = await makeHostPackage('1.0.0')
    const second = await makeHostPackage('1.0.0', false, '@example/other-host')
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const packages = new LocalFabricPackageManager(store, '0.8.2')
    await packages.install(first)
    await packages.install(second)

    const ctx = new Context()
    ctx.provide('fabricHost', new FabricResourceHostService())
    const hosts = new FabricRuntimeHostManager(ctx, store)
    await hosts.start()

    await hosts.beginClientRetraction('@example/runtime-host')
    expect(store.inventory.readPublished().plugins['@example/runtime-host']?.enabled).toBe(false)
    expect(store.inventory.readPublished().plugins['@example/other-host']?.enabled).toBe(true)
    await hosts.beginClientRetraction('@example/other-host')
    expect(store.inventory.readPublished().plugins['@example/runtime-host']?.enabled).toBe(false)
    expect(store.inventory.readPublished().plugins['@example/other-host']?.enabled).toBe(false)
    await hosts.endClientRetraction('@example/runtime-host')
    expect(store.inventory.readPublished().plugins['@example/runtime-host']?.enabled).toBe(true)
    expect(store.inventory.readPublished().plugins['@example/other-host']?.enabled).toBe(false)
    await hosts.endClientRetraction('@example/other-host')
    expect(store.inventory.readPublished().plugins['@example/other-host']?.enabled).toBe(true)

    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('does not commit a rollback target whose Host setup fails', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-runtime-profile-'))
    roots.push(profile)
    const failedPrevious = await makeHostPackage('1.0.0', true)
    const current = await makeHostPackage('2.0.0')
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const packages = new LocalFabricPackageManager(store, '0.8.2')
    await packages.install(failedPrevious)
    await packages.install(current)

    const ctx = new Context()
    ctx.provide('fabricHost', new FabricResourceHostService())
    const hosts = new FabricRuntimeHostManager(ctx, store)
    await hosts.start()

    await expect(packages.rollback('@example/runtime-host', {
      beforeCommit: (name, fallback, candidate) => hosts.activateCandidate(name, candidate, fallback),
    })).rejects.toThrow('host setup failed')
    expect((await packages.inventory()).plugins['@example/runtime-host']).toMatchObject({
      version: '2.0.0',
      enabled: true,
      previous: { version: '1.0.0' },
    })
    expect(hosts.state('@example/runtime-host')).toMatchObject({ version: '2.0.0', status: 'active' })
    await expect(store.readManifest('@example/runtime-host', '1.0.0')).resolves.toMatchObject({ version: '1.0.0' })

    await hosts.dispose()
    await ctx.fiber.dispose()
  })
})
