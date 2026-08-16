import {
  capabilityFamilyKey, capabilityKey, defineCapability,
  type FabricCapabilityBinding, type FabricCapabilityDefinition,
  type FabricCapabilityProviderHandle, type FabricCapabilitySnapshot,
} from '../capability/contract.ts'

interface CapabilityRecord<T extends object = object> {
  readonly definition: FabricCapabilityDefinition<T>
  readonly implementation: T
  readonly revoke: () => void
  readonly generation: string
}

class CapabilityBinding<T extends object> implements FabricCapabilityBinding<T> {
  private readonly listeners = new Set<() => void>()
  private snapshot: FabricCapabilitySnapshot<T>
  private disposed = false

  constructor(
    readonly definition: FabricCapabilityDefinition<T>,
    private readonly registry: FabricCapabilityRegistry,
  ) {
    this.snapshot = registry.snapshot(definition)
  }

  getSnapshot(): FabricCapabilitySnapshot<T> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    this.registry.release(this)
  }

  refresh(): void {
    const next = this.registry.snapshot(this.definition)
    if (
      next.status === this.snapshot.status
      && next.value === this.snapshot.value
      && next.generation === this.snapshot.generation
      && next.availableVersions.length === this.snapshot.availableVersions.length
      && next.availableVersions.every((version, index) => version === this.snapshot.availableVersions[index])
    ) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }

  clear(): void {
    this.disposed = true
    this.listeners.clear()
  }
}

export interface FabricCapabilityService {
  provide<T extends object>(
    providerOwner: string,
    definition: FabricCapabilityDefinition<T>,
    implementation: T,
    generation?: string,
  ): FabricCapabilityProviderHandle<T>
  consume<T extends object>(definition: FabricCapabilityDefinition<T>): FabricCapabilityBinding<T>
  list(): readonly string[]
  dispose(): void
}

function assertImplementation<T extends object>(value: T, label: string): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new Error(`fabric capability "${label}" implementation must be an object`)
  }
}

/**
 * Profile-local capability table. Bindings are live: unloading a provider
 * revokes its proxy before publishing `unavailable`.
 */
export class FabricCapabilityRegistry implements FabricCapabilityService {
  private readonly implementations = new Map<string, CapabilityRecord>()
  private readonly bindings = new Set<CapabilityBinding<object>>()
  private nextGeneration = 0

  provide<T extends object>(
    providerOwner: string,
    definition: FabricCapabilityDefinition<T>,
    implementation: T,
    generation = `capability-${++this.nextGeneration}`,
  ): FabricCapabilityProviderHandle<T> {
    const normalized = defineCapability(definition)
    if (providerOwner !== normalized.owner) {
      throw new Error(`fabric capability provider "${providerOwner}" cannot provide "${normalized.owner}/${normalized.id}"`)
    }
    assertImplementation(implementation, `${normalized.owner}/${normalized.id}`)
    const key = capabilityKey(normalized)
    if (this.implementations.has(key)) {
      throw new Error(`fabric capability "${normalized.owner}/${normalized.id}@${normalized.version}" is already registered`)
    }
    const revocable = Proxy.revocable(implementation, {})
    const record: CapabilityRecord<T> = {
      definition: normalized,
      implementation: revocable.proxy,
      revoke: revocable.revoke,
      generation,
    }
    this.implementations.set(key, record)
    this.refreshBindings(normalized)
    let disposed = false
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      if (this.implementations.get(key) !== record) return
      record.revoke()
      this.implementations.delete(key)
      this.refreshBindings(normalized)
    }
    return Object.freeze({ definition: normalized, generation, dispose })
  }

  consume<T extends object>(definition: FabricCapabilityDefinition<T>): FabricCapabilityBinding<T> {
    const normalized = defineCapability(definition)
    const binding = new CapabilityBinding(normalized, this)
    this.bindings.add(binding as CapabilityBinding<object>)
    return binding
  }

  list(): readonly string[] {
    return [...this.implementations.values()]
      .map(record => `${record.definition.owner}/${record.definition.id}@${record.definition.version}`)
      .sort()
  }

  snapshot<T extends object>(definition: FabricCapabilityDefinition<T>): FabricCapabilitySnapshot<T> {
    const family = capabilityFamilyKey(definition)
    const records = [...this.implementations.values()]
      .filter(record => capabilityFamilyKey(record.definition) === family)
      .sort((left, right) => left.definition.version.localeCompare(right.definition.version))
    const exact = this.implementations.get(capabilityKey(definition)) as CapabilityRecord<T> | undefined
    if (exact !== undefined) {
      return {
        status: 'available',
        value: exact.implementation,
        owner: definition.owner,
        id: definition.id,
        version: definition.version,
        availableVersions: records.map(record => record.definition.version),
        generation: exact.generation,
      }
    }
    return {
      status: records.length === 0 ? 'unavailable' : 'incompatible',
      value: undefined,
      owner: definition.owner,
      id: definition.id,
      version: definition.version,
      availableVersions: records.map(record => record.definition.version),
      generation: undefined,
    }
  }

  dispose(): void {
    for (const record of this.implementations.values()) record.revoke()
    this.implementations.clear()
    for (const binding of this.bindings) binding.refresh()
    for (const binding of this.bindings) binding.clear()
    this.bindings.clear()
  }

  release(binding: CapabilityBinding<object>): void {
    this.bindings.delete(binding)
  }

  private refreshBindings(definition: FabricCapabilityDefinition): void {
    for (const binding of this.bindings) {
      if (capabilityFamilyKey(binding.definition) === capabilityFamilyKey(definition)) binding.refresh()
    }
  }
}
