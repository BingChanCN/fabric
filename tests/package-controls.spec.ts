import { describe, expect, it, vi } from 'vitest'
import { FabricResourceHostService } from '../src/host/resources.ts'
import { provideFabricPackageControls } from '../src/host/package-controls.ts'
import type { FabricPackageManager } from '../src/host/package-store.ts'
import type { FabricRuntimeClientRegistry } from '../src/host/runtime-clients.ts'
import type { FabricRuntimeHostManager } from '../src/runtime/host-manager.ts'
import type { FabricInventory, FabricInventoryEntry } from '../src/runtime/inventory.ts'
import { fabricDisablePackageOperation } from '../src/runtime/control.ts'

function snapshot(entry: FabricInventoryEntry): FabricInventory {
  return { format: 1, revision: 1, plugins: { '@example/weather': entry } }
}

describe('Fabric package control sequencing', () => {
  it('waits for connected clients to retract before stopping the Host', async () => {
    const calls: string[] = []
    let entry: FabricInventoryEntry = { version: '1.0.0', source: 'file:/weather', enabled: true }
    const manager = {
      inventory: async () => snapshot(entry),
      disable: async () => {
        calls.push('commit-disabled')
        entry = { ...entry, enabled: false }
        return entry
      },
    } as unknown as FabricPackageManager
    let releaseClients!: () => void
    const clients = {
      waitForInactive: async (_name: string, generation: string) => {
        calls.push(`wait-clients:${generation}`)
        await new Promise<void>(resolve => { releaseClients = resolve })
        calls.push('clients-inactive')
      },
    } as unknown as FabricRuntimeClientRegistry
    const hosts = {
      beginClientRetraction: async () => {
        calls.push('publish-retract')
        return { format: 1, revision: 2, plugins: {} }
      },
      endClientRetraction: async () => {
        calls.push('publish-active')
        return { format: 1, revision: 3, plugins: {} }
      },
      publishClientInventory: async () => ({ format: 1, revision: 3, plugins: {} }),
      reconcileNow: async () => { calls.push('stop-host') },
      state: () => ({ packageName: '@example/weather', version: '1.0.0', status: 'inactive' }),
    } as unknown as FabricRuntimeHostManager
    const runtime = new FabricResourceHostService()
    const dispose = provideFabricPackageControls(runtime, manager, hosts, Promise.resolve(), clients)

    const handle = runtime.operations.start(fabricDisablePackageOperation, { name: '@example/weather' })
    await vi.waitFor(() => expect(calls).toEqual(['publish-retract', 'wait-clients:2']))
    expect(entry.enabled).toBe(true)

    releaseClients()
    await expect(handle.result()).resolves.toMatchObject({ enabled: false })
    expect(calls).toEqual([
      'publish-retract', 'wait-clients:2', 'clients-inactive',
      'commit-disabled', 'stop-host', 'publish-active',
    ])
    dispose()
  })
})
