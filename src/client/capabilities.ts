export type FabricCapabilityScope = 'profile' | 'session'

interface CapabilityRecord<T = unknown> {
  readonly id: string
  readonly version: string
  readonly scope: FabricCapabilityScope
  readonly implementation: T
}

export interface FabricCapabilityService {
  register<T>(id: string, version: string, scope: FabricCapabilityScope, impl: T): () => void
  get<T>(id: string, version?: string, scope?: FabricCapabilityScope): T | undefined
  list(): readonly string[]
}

/** Profile runtime capability table. Versions are exact contract identifiers. */
export class FabricCapabilityRegistry implements FabricCapabilityService {
  private readonly impls = new Map<string, CapabilityRecord>()

  register<T>(id: string, version: string, scope: FabricCapabilityScope, impl: T): () => void {
    if (id.trim() === '') throw new Error('fabric capability id is empty')
    if (version.trim() === '') throw new Error(`fabric capability "${id}" version is empty`)
    const key = `${scope}:${id}`
    if (this.impls.has(key)) throw new Error(`fabric capability "${id}" is already registered for ${scope}`)
    const record: CapabilityRecord<T> = { id, version, scope, implementation: impl }
    this.impls.set(key, record)
    return () => {
      if (this.impls.get(key) === record) this.impls.delete(key)
    }
  }

  get<T>(id: string, version?: string, scope: FabricCapabilityScope = 'profile'): T | undefined {
    const record = this.impls.get(`${scope}:${id}`) as CapabilityRecord<T> | undefined
    if (record === undefined || (version !== undefined && record.version !== version)) return undefined
    return record.implementation
  }

  list(): readonly string[] {
    return [...this.impls.values()].map(record => `${record.id}@${record.version}`).sort()
  }

  dispose(): void {
    this.impls.clear()
  }
}
