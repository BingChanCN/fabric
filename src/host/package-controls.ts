import type { FabricResourceHost } from '../resource/contract.ts'
import type { FabricPackageOperationProgress } from '../runtime/control.ts'
import {
  fabricDisablePackageOperation, fabricEnablePackageOperation, fabricInstallPackageOperation,
  fabricPackageInventoryResource, fabricPurgePackageOperation, fabricRemovePackageOperation,
  fabricRollbackPackageOperation, fabricUpdatePackageOperation,
} from '../runtime/control.ts'
import type { FabricRuntimeHostManager } from '../runtime/host-manager.ts'
import type { FabricInventoryEntry } from '../runtime/inventory.ts'
import type { FabricPackageManager } from './package-store.ts'
import type { FabricRuntimeClientRegistry } from './runtime-clients.ts'

function reportStage(report: (progress: FabricPackageOperationProgress) => void, stage: FabricPackageOperationProgress['stage']): void {
  report({ stage })
}

async function settleHost(
  manager: FabricPackageManager,
  hosts: FabricRuntimeHostManager,
  name: string,
  expected: FabricInventoryEntry | undefined,
): Promise<void> {
  await hosts.reconcileNow()
  const activationError = expected?.enabled === true ? hosts.activationError(name, expected.version) : undefined
  if (activationError !== undefined) throw new Error(activationError)
  const current = (await manager.inventory()).plugins[name]
  if (expected === undefined) {
    if (current !== undefined) throw new Error(`fabric package "${name}" was not removed`)
    return
  }
  if (current?.version !== expected.version || current.enabled !== expected.enabled) {
    const state = hosts.state(name)
    throw new Error(state?.error ?? `fabric package "${name}" failed to reach its desired state`)
  }
  if (expected.enabled && hosts.state(name)?.status !== 'active') {
    throw new Error(hosts.state(name)?.error ?? `fabric package "${name}" Host did not become active`)
  }
}

/** Register Core-owned package query and mutations on the public Resource/Operation transports. */
export function provideFabricPackageControls(
  runtime: FabricResourceHost,
  manager: FabricPackageManager,
  hosts: FabricRuntimeHostManager,
  ready: Promise<void> = Promise.resolve(),
  clients?: FabricRuntimeClientRegistry,
  dev?: {
    isActive(packageName: string): boolean
    acquireExclusive(packageName: string): Promise<() => void>
  },
): () => void {
  const disposers: (() => void)[] = []
  const assertNotInDev = (name: string): void => {
    if (dev?.isActive(name) === true) throw new Error(`fabric package "${name}" is active in fabric dev`)
  }
  const acquirePackageMutation = async (name: string): Promise<() => void> => {
    const release = dev === undefined ? () => {} : await dev.acquireExclusive(name)
    try {
      assertNotInDev(name)
      return release
    } catch (error) {
      release()
      throw error
    }
  }
  const runPackageMutation = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    const release = await acquirePackageMutation(name)
    try {
      return await action()
    } finally {
      release()
    }
  }
  const retractClients = async (name: string, signal?: AbortSignal): Promise<(() => Promise<void>) | undefined> => {
    const current = (await manager.inventory()).plugins[name]
    if (current?.enabled !== true) return undefined
    const snapshot = await hosts.beginClientRetraction(name)
    try {
      await clients?.waitForInactive(name, `${snapshot.revision}`, signal)
    } catch (error) {
      await hosts.endClientRetraction(name)
      throw error
    }
    let active = true
    return async () => {
      if (!active) return
      active = false
      await hosts.endClientRetraction(name)
    }
  }
  const publishAfter = async (release: (() => Promise<void>) | undefined): Promise<void> => {
    if (release === undefined) await hosts.publishClientInventory()
    else await release()
  }
  disposers.push(runtime.provide('@dsh-do/fabric', fabricPackageInventoryResource, {
    query: async () => {
      await ready
      return manager.inventory()
    },
  }))
  const install = async (
    source: string,
    run: { readonly signal: AbortSignal; report(progress: FabricPackageOperationProgress): void },
  ): Promise<FabricInventoryEntry> => {
    await ready
    reportStage(run.report, 'resolving')
    let installed
    let releaseClients: (() => Promise<void>) | undefined
    let releasePackage: (() => void) | undefined
    try {
      try {
        installed = await manager.install(source, {
          signal: run.signal,
          onStage: stage => reportStage(run.report, stage),
          beforeCommit: async (name, current, candidate) => {
            releasePackage = await acquirePackageMutation(name)
            if (current?.enabled === true) {
              reportStage(run.report, 'stopping-client')
              releaseClients = await retractClients(name, run.signal)
            }
            reportStage(run.report, 'stopping-host')
            reportStage(run.report, 'starting-host')
            await hosts.activateCandidate(name, candidate)
          },
        })
        await settleHost(manager, hosts, installed.name, installed.entry)
      } catch (error) {
        await hosts.reconcileNow()
        await publishAfter(releaseClients)
        throw error
      }
      await publishAfter(releaseClients)
      reportStage(run.report, 'starting-client')
      reportStage(run.report, 'completed')
      return installed.entry
    } finally {
      releasePackage?.()
    }
  }
  disposers.push(runtime.operations.provide(fabricInstallPackageOperation, (input, run) => install(input.source, run)))
  disposers.push(runtime.operations.provide(fabricUpdatePackageOperation, async (input, run) => {
    await ready
    return runPackageMutation(input.name, async () => {
      reportStage(run.report, 'resolving')
      let installed
      let releaseClients: (() => Promise<void>) | undefined
      try {
        installed = await manager.update(input.name, {
          signal: run.signal,
          onStage: stage => reportStage(run.report, stage),
          beforeCommit: async (name, current, candidate) => {
            assertNotInDev(name)
            if (current?.enabled === true) {
              reportStage(run.report, 'stopping-client')
              releaseClients = await retractClients(name, run.signal)
            }
            reportStage(run.report, 'stopping-host')
            reportStage(run.report, 'starting-host')
            await hosts.activateCandidate(name, candidate)
          },
        })
        await settleHost(manager, hosts, installed.name, installed.entry)
      } catch (error) {
        await hosts.reconcileNow()
        await publishAfter(releaseClients)
        throw error
      }
      await publishAfter(releaseClients)
      reportStage(run.report, 'starting-client')
      reportStage(run.report, 'completed')
      return installed.entry
    })
  }))
  disposers.push(runtime.operations.provide(fabricEnablePackageOperation, async (input, run) => {
    await ready
    return runPackageMutation(input.name, async () => {
      reportStage(run.report, 'starting-host')
      const entry = await manager.enable(input.name)
      await settleHost(manager, hosts, input.name, entry)
      await hosts.publishClientInventory()
      reportStage(run.report, 'starting-client')
      reportStage(run.report, 'completed')
      return entry
    })
  }))
  disposers.push(runtime.operations.provide(fabricDisablePackageOperation, async (input, run) => {
    await ready
    return runPackageMutation(input.name, async () => {
      reportStage(run.report, 'stopping-client')
      const releaseClients = await retractClients(input.name, run.signal)
      try {
        const entry = await manager.disable(input.name)
        reportStage(run.report, 'stopping-host')
        await settleHost(manager, hosts, input.name, entry)
        await publishAfter(releaseClients)
        reportStage(run.report, 'completed')
        return entry
      } catch (error) {
        await hosts.reconcileNow()
        await publishAfter(releaseClients)
        throw error
      }
    })
  }))
  disposers.push(runtime.operations.provide(fabricRollbackPackageOperation, async (input, run) => {
    await ready
    return runPackageMutation(input.name, async () => {
      reportStage(run.report, 'stopping-client')
      const releaseClients = await retractClients(input.name, run.signal)
      try {
        reportStage(run.report, 'stopping-host')
        reportStage(run.report, 'starting-host')
        const entry = await manager.rollback(input.name, {
          signal: run.signal,
          beforeCommit: async (name, current, candidate) => {
            await hosts.activateCandidate(name, candidate, current)
          },
        })
        await settleHost(manager, hosts, input.name, entry)
        await publishAfter(releaseClients)
        reportStage(run.report, 'starting-client')
        reportStage(run.report, 'completed')
        return entry
      } catch (error) {
        await hosts.reconcileNow()
        await publishAfter(releaseClients)
        throw error
      }
    })
  }))
  const remove = async (
    input: { name: string },
    run: { readonly signal: AbortSignal; report(progress: FabricPackageOperationProgress): void },
    purge: boolean,
  ): Promise<void> => {
    await ready
    return runPackageMutation(input.name, async () => {
      reportStage(run.report, 'stopping-client')
      const releaseClients = await retractClients(input.name, run.signal)
      try {
        reportStage(run.report, 'stopping-host')
        if (purge) await manager.purge(input.name)
        else await manager.remove(input.name)
        await settleHost(manager, hosts, input.name, undefined)
        await publishAfter(releaseClients)
        reportStage(run.report, 'completed')
      } catch (error) {
        await hosts.reconcileNow()
        await publishAfter(releaseClients)
        throw error
      }
    })
  }
  disposers.push(runtime.operations.provide(fabricRemovePackageOperation, (input, run) => remove(input, run, false)))
  disposers.push(runtime.operations.provide(fabricPurgePackageOperation, (input, run) => remove(input, run, true)))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
