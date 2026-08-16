import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricDevRuntimeManager } from '../src/host/dev-runtime.ts'
import { provideFabricPackageControls } from '../src/host/package-controls.ts'
import { FabricPackageStore, FabricInventoryStore, LocalFabricPackageManager } from '../src/host/package-store.ts'
import { FabricResourceHostService } from '../src/host/resources.ts'
import { FabricRuntimeClientRegistry } from '../src/host/runtime-clients.ts'
import { fabricDisablePackageOperation } from '../src/runtime/control.ts'
import { FabricRuntimeHostManager } from '../src/runtime/host-manager.ts'

const roots: string[] = []

declare global {
  // eslint-disable-next-line no-var
  var __fabricDevRuntimeTest: { starts: string[]; stops: string[] } | undefined
  // eslint-disable-next-line no-var
  var __fabricDevRuntimeGate: Promise<void> | undefined
}

async function packageSource(
  label: string,
  fail = false,
  packageName = '@example/dev-package',
  waitForGate = false,
  waitOnRestart = false,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fabric-dev-package-'))
  roots.push(root)
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    fabric: { format: 1, api: '^1.0.0', host: './lib/fabric-host.js', client: './lib/fabric-client.js' },
  }))
  await writeFile(join(root, 'lib', 'fabric-host.js'), [
    'const marker = globalThis.__fabricDevRuntimeTest ??= { starts: [], stops: [] };',
    `export default { descriptor: { name: "Dev test" }, ${waitForGate || waitOnRestart ? 'async ' : ''}setup() {`,
    `  const restarting = marker.starts.includes(${JSON.stringify(label)});`,
    `  marker.starts.push(${JSON.stringify(label)});`,
    ...(waitForGate ? ['  await globalThis.__fabricDevRuntimeGate;'] : []),
    ...(waitOnRestart ? ['  if (restarting) await globalThis.__fabricDevRuntimeGate;'] : []),
    fail ? `  throw new Error(${JSON.stringify(`${label} failed`)});` : `  return () => marker.stops.push(${JSON.stringify(label)});`,
    '} };',
  ].join('\n'))
  await writeFile(join(root, 'lib', 'fabric-client.js'), [
    '(function(){',
    `const id = ${JSON.stringify(`fabric-runtime/${encodeURIComponent(packageName)}`)};`,
    'window.__ModuleLoader__.load({ id, factory(){ return { default: { descriptor: { name: "Dev test" }, setup() {} } }; } });',
    '})();',
  ].join('\n'))
  return root
}

async function runtime(
  leaseTimeoutMs = 5_000,
  inactiveTimeoutMs = 10_000,
  gateProductionRestart = false,
) {
  const profile = await mkdtemp(join(tmpdir(), 'fabric-dev-profile-'))
  roots.push(profile)
  const store = new FabricPackageStore(new FabricInventoryStore(profile))
  const packages = new LocalFabricPackageManager(store, '1.0.0')
  const production = await packageSource('production', false, '@example/dev-package', false, gateProductionRestart)
  await packages.install(production)
  const ctx = new Context()
  const service = new FabricResourceHostService()
  ctx.provide('fabricHost', service)
  const hosts = new FabricRuntimeHostManager(ctx, store)
  await hosts.start()
  const clients = new FabricRuntimeClientRegistry(inactiveTimeoutMs)
  const dev = new FabricDevRuntimeManager(store, hosts, clients, '1.0.0', Promise.resolve(), leaseTimeoutMs)
  return { profile, store, packages, ctx, hosts, clients, dev, service }
}

afterEach(async () => {
  globalThis.__fabricDevRuntimeTest = undefined
  globalThis.__fabricDevRuntimeGate = undefined
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('FabricDevRuntimeManager', () => {
  it('overlays and reloads the same version without changing production desired state', async () => {
    const { store, packages, ctx, hosts, dev } = await runtime()
    const before = (await packages.inventory()).plugins['@example/dev-package']!
    const first = await packageSource('dev-1')
    const second = await packageSource('dev-2')
    const failed = await packageSource('dev-broken', true)

    await dev.apply({ leaseId: 'lease', generation: 1, source: first })
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.1')
    expect((await packages.inventory()).plugins['@example/dev-package']).toEqual(before)

    await dev.apply({ leaseId: 'lease', generation: 2, source: second })
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.2')
    await hosts.publishClientInventory()
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.2')
    await expect(dev.apply({ leaseId: 'lease', generation: 3, source: failed })).rejects.toThrow('dev-broken failed')
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.2')
    expect((await packages.inventory()).plugins['@example/dev-package']).toEqual(before)

    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe(before.source)
    expect(globalThis.__fabricDevRuntimeTest).toEqual({
      starts: ['production', 'dev-1', 'dev-2', 'dev-broken', 'dev-2', 'production'],
      stops: ['production', 'dev-1', 'dev-2', 'dev-2'],
    })

    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps an active overlay when an unrelated production package reconciles', async () => {
    const { store, packages, ctx, hosts, dev } = await runtime()
    const first = await packageSource('dev-1')
    const other = await packageSource('other-production', false, '@example/other-package')
    await dev.apply({ leaseId: 'lease', generation: 1, source: first })

    await packages.install(other)
    await hosts.reconcileNow()
    await hosts.publishClientInventory()
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.1')
    expect(hosts.state('@example/dev-package')).toMatchObject({ status: 'active', version: '1.0.0' })
    expect(globalThis.__fabricDevRuntimeTest?.stops).toEqual(['production'])

    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('commits the override before a queued production reconcile can replace a starting Dev Host', async () => {
    const { store, packages, ctx, hosts, dev } = await runtime()
    const slow = await packageSource('dev-slow', false, '@example/dev-package', true)
    const other = await packageSource('other-production', false, '@example/other-package')
    let releaseGate!: () => void
    globalThis.__fabricDevRuntimeGate = new Promise<void>(resolve => { releaseGate = resolve })

    const applying = dev.apply({ leaseId: 'lease', generation: 1, source: slow })
    await vi.waitFor(() => expect(globalThis.__fabricDevRuntimeTest?.starts).toContain('dev-slow'))
    await packages.install(other)
    releaseGate()
    await applying
    await hosts.reconcileNow()
    await hosts.publishClientInventory()

    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.1')
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.enabled).toBe(true)
    expect(globalThis.__fabricDevRuntimeTest?.stops).toEqual(['production'])

    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('blocks a production mutation until an in-flight Dev apply owns the package', async () => {
    const { store, packages, ctx, hosts, clients, dev, service } = await runtime()
    const slow = await packageSource('dev-slow', false, '@example/dev-package', true)
    let releaseGate!: () => void
    globalThis.__fabricDevRuntimeGate = new Promise<void>(resolve => { releaseGate = resolve })
    const disposeControls = provideFabricPackageControls(
      service,
      packages,
      hosts,
      Promise.resolve(),
      clients,
      dev,
    )

    const applying = dev.apply({ leaseId: 'lease', generation: 1, source: slow })
    await vi.waitFor(() => expect(globalThis.__fabricDevRuntimeTest?.starts).toContain('dev-slow'))
    const disabling = service.operations.start(fabricDisablePackageOperation, { name: '@example/dev-package' })
    releaseGate()
    await applying

    await expect(disabling.result()).rejects.toThrow('active in fabric dev')
    expect((await packages.inventory()).plugins['@example/dev-package']?.enabled).toBe(true)
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.1')

    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    disposeControls()
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('serializes production restoration with a concurrent inventory reconcile', async () => {
    const { packages, ctx, hosts, dev } = await runtime(5_000, 10_000, true)
    const first = await packageSource('dev-1')
    const other = await packageSource('other-production', false, '@example/other-package')
    await dev.apply({ leaseId: 'lease', generation: 1, source: first })
    let releaseGate!: () => void
    globalThis.__fabricDevRuntimeGate = new Promise<void>(resolve => { releaseGate = resolve })

    const stopping = dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    await vi.waitFor(() => {
      expect(globalThis.__fabricDevRuntimeTest?.starts.filter(label => label === 'production')).toHaveLength(2)
    })
    await packages.install(other)
    releaseGate()
    await stopping
    await hosts.reconcileNow()

    expect(globalThis.__fabricDevRuntimeTest?.starts.filter(label => label === 'production')).toHaveLength(2)
    expect(hosts.state('@example/dev-package')).toMatchObject({ status: 'active', version: '1.0.0' })

    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a duplicate generation without replacing its active snapshot', async () => {
    const { store, ctx, hosts, dev } = await runtime()
    const first = await packageSource('dev-1')
    const duplicate = await packageSource('duplicate')
    await dev.apply({ leaseId: 'lease', generation: 1, source: first })

    await expect(dev.apply({ leaseId: 'lease', generation: 1, source: duplicate })).rejects.toThrow('already admitted')
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.1')
    await expect(store.readManifest('@example/dev-package', '1.0.0', 'dev:lease.1')).resolves.toMatchObject({ name: '@example/dev-package' })

    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('expires a lease and restores production even when a connected tab does not acknowledge', async () => {
    const { store, ctx, hosts, clients, dev } = await runtime(20, 10)
    const first = await packageSource('dev-1')
    await dev.apply({ leaseId: 'lease', generation: 1, source: first })
    const disconnect = clients.connect('unresponsive-tab')

    await vi.waitFor(() => {
      expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).not.toBe('dev:lease.1')
    }, { timeout: 2_000 })
    expect(store.inventory.readPublished().plugins['@example/dev-package']).toMatchObject({ enabled: true })
    expect(hosts.state('@example/dev-package')).toMatchObject({ status: 'active', version: '1.0.0' })

    disconnect()
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the overlay when an explicit stop times out waiting for a connected tab', async () => {
    const { store, ctx, hosts, clients, dev } = await runtime(5_000, 10)
    const first = await packageSource('dev-1')
    await dev.apply({ leaseId: 'lease', generation: 1, source: first })
    const disconnect = clients.connect('unresponsive-tab')

    await expect(dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })).rejects.toThrow('did not retract')
    expect(dev.isActive('@example/dev-package')).toBe(true)
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe('dev:lease.1')
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.enabled).toBe(true)

    disconnect()
    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a late apply after the lease has been stopped', async () => {
    const { store, packages, ctx, hosts, dev } = await runtime()
    const first = await packageSource('dev-1')
    const late = await packageSource('dev-late')
    const before = (await packages.inventory()).plugins['@example/dev-package']!
    await dev.apply({ leaseId: 'lease', generation: 1, source: first })
    await dev.stop({ leaseId: 'lease', packageName: '@example/dev-package' })

    await expect(dev.apply({ leaseId: 'lease', generation: 2, source: late })).rejects.toThrow('lease is not active')
    expect(dev.isActive('@example/dev-package')).toBe(false)
    expect(store.inventory.readPublished().plugins['@example/dev-package']?.source).toBe(before.source)
    expect((await packages.inventory()).plugins['@example/dev-package']).toEqual(before)

    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a second lease for the same package', async () => {
    const { ctx, hosts, dev } = await runtime()
    const first = await packageSource('dev-1')
    const second = await packageSource('dev-2')
    await dev.apply({ leaseId: 'lease-a', generation: 1, source: first })
    await expect(dev.apply({ leaseId: 'lease-b', generation: 1, source: second })).rejects.toThrow('already has an active lease')
    await dev.stop({ leaseId: 'lease-a', packageName: '@example/dev-package' })
    await dev.dispose()
    await hosts.dispose()
    await ctx.fiber.dispose()
  })
})
