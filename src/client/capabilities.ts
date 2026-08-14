export interface FabricCapabilityService {
  register<T>(id: string, impl: T): () => void
  get<T>(id: string): T | undefined
  list(): readonly string[]
}

/** Named capability table. One implementation per id; later register throws. */
export class FabricCapabilityRegistry implements FabricCapabilityService {
  private readonly impls = new Map<string, unknown>()

  register<T>(id: string, impl: T): () => void {
    if (id.trim() === '') throw new Error('fabric capability id is empty')
    if (this.impls.has(id)) throw new Error(`fabric capability "${id}" is already registered`)
    this.impls.set(id, impl)
    return () => { this.impls.delete(id) }
  }

  get<T>(id: string): T | undefined {
    return this.impls.get(id) as T | undefined
  }

  list(): readonly string[] {
    return [...this.impls.keys()].sort()
  }

  dispose(): void {
    this.impls.clear()
  }
}
