import type {
  FabricCredentialDefinition, FabricCredentialInfo, FabricResolvedCredential,
} from '../credential/contract.ts'
import { defineCredential, fabricCredentialResource } from '../credential/contract.ts'
import { FabricResourceError, type FabricResourceHost } from '../resource/contract.ts'

export interface DshCredentialProvider {
  resolve(ref: string): Promise<FabricResolvedCredential | undefined>
  describe(ref: string): Promise<FabricCredentialInfo>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

interface CredentialRecord {
  readonly definition: FabricCredentialDefinition
}

function key(owner: string, id: string): string {
  return `${owner}\u0000${id}`
}

/** Lifecycle registry over DSH's credential provider; secret values never enter Client responses. */
export class FabricCredentialService {
  private readonly definitions = new Map<string, CredentialRecord>()

  constructor(private readonly provider: DshCredentialProvider) {}

  declare(owner: string, definition: FabricCredentialDefinition): () => void {
    const token = defineCredential(definition)
    if (token.owner !== owner) throw new Error(`fabric credential provider "${owner}" cannot declare contract owned by "${token.owner}"`)
    const id = key(token.owner, token.id)
    if (this.definitions.has(id)) throw new Error(`fabric credential "${token.owner}/${token.id}" is already declared`)
    const record = { definition: token }
    this.definitions.set(id, record)
    return () => {
      if (this.definitions.get(id) === record) this.definitions.delete(id)
    }
  }

  async resolve(owner: string, definition: FabricCredentialDefinition): Promise<FabricResolvedCredential | undefined> {
    return this.provider.resolve(this.require(owner, definition).ref)
  }

  async describe(owner: string, definition: FabricCredentialDefinition): Promise<FabricCredentialInfo> {
    return this.provider.describe(this.require(owner, definition).ref)
  }

  async describeIdentity(owner: string, id: string, version: string): Promise<FabricCredentialInfo> {
    const definition = this.requireIdentity(owner, id, version)
    return this.provider.describe(definition.ref)
  }

  async set(owner: string, id: string, version: string, value: string): Promise<FabricCredentialInfo> {
    const definition = this.requireIdentity(owner, id, version)
    await this.provider.set(definition.ref, value)
    return this.provider.describe(definition.ref)
  }

  async unset(owner: string, id: string, version: string): Promise<FabricCredentialInfo> {
    const definition = this.requireIdentity(owner, id, version)
    await this.provider.unset(definition.ref)
    return this.provider.describe(definition.ref)
  }

  dispose(): void {
    this.definitions.clear()
  }

  private require(owner: string, definition: FabricCredentialDefinition): FabricCredentialDefinition {
    const token = defineCredential(definition)
    if (token.owner !== owner) throw new Error(`fabric credential consumer "${owner}" cannot access "${token.owner}/${token.id}"`)
    return this.requireIdentity(token.owner, token.id, token.version)
  }

  private requireIdentity(owner: string, id: string, version: string): FabricCredentialDefinition {
    const record = this.definitions.get(key(owner, id))
    if (record === undefined) {
      throw new FabricResourceError({ code: 'credential-unavailable', message: `credential "${owner}/${id}" is unavailable` })
    }
    if (record.definition.version !== version) {
      throw new FabricResourceError({ code: 'credential-version-mismatch', message: `credential "${owner}/${id}" requires version "${record.definition.version}"` })
    }
    return record.definition
  }
}

export function provideFabricCredentialResource(runtime: FabricResourceHost, service: FabricCredentialService): () => void {
  return runtime.provide('@dsh-do/fabric', fabricCredentialResource, {
    query: async request => {
      if (request.operation !== 'describe') throw new FabricResourceError({ code: 'operation-not-supported', message: 'credential query requires describe' })
      return service.describeIdentity(request.owner, request.id, request.version)
    },
    mutate: async request => {
      if (request.operation === 'set') return service.set(request.owner, request.id, request.version, request.value!)
      if (request.operation === 'unset') return service.unset(request.owner, request.id, request.version)
      throw new FabricResourceError({ code: 'operation-not-supported', message: 'credential mutation requires set or unset' })
    },
  })
}
