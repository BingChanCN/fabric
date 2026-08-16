import { defineCodec, defineResource } from '../resource/contract.ts'

export interface FabricCredentialDefinition {
  readonly owner: string
  readonly id: string
  readonly version: string
  readonly ref: string
}

export interface FabricCredentialInfo {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

export interface FabricResolvedCredential {
  readonly value: string
  readonly source: string
}

const CONTRACT_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u

export function defineCredential(definition: FabricCredentialDefinition): FabricCredentialDefinition {
  if (definition.owner.trim() === '') throw new Error('fabric credential owner is empty')
  if (!CONTRACT_ID.test(definition.id)) throw new Error(`fabric credential id "${definition.id}" is invalid`)
  if (definition.version.trim() === '') throw new Error(`fabric credential "${definition.owner}/${definition.id}" version is empty`)
  if (!CREDENTIAL_REF.test(definition.ref)) throw new Error(`fabric credential ref "${definition.ref}" is invalid`)
  return Object.freeze({ ...definition })
}

export interface FabricCredentialHost {
  declare(owner: string, definition: FabricCredentialDefinition): () => void
  resolve(owner: string, definition: FabricCredentialDefinition): Promise<FabricResolvedCredential | undefined>
  describe(owner: string, definition: FabricCredentialDefinition): Promise<FabricCredentialInfo>
}

export interface FabricPluginCredentialHost {
  declare(definition: FabricCredentialDefinition): void
  resolve(definition: FabricCredentialDefinition): Promise<FabricResolvedCredential | undefined>
  describe(definition: FabricCredentialDefinition): Promise<FabricCredentialInfo>
}

export interface FabricCredentialRequest {
  readonly operation: 'describe' | 'set' | 'unset'
  readonly owner: string
  readonly id: string
  readonly version: string
  readonly value?: string
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

const requestCodec = defineCodec<FabricCredentialRequest>(value => {
  const item = record(value, 'credential request')
  if (item.operation !== 'describe' && item.operation !== 'set' && item.operation !== 'unset') {
    throw new Error('credential operation is invalid')
  }
  const definition = defineCredential({
    owner: String(item.owner ?? ''),
    id: String(item.id ?? ''),
    version: String(item.version ?? ''),
    ref: 'PLACEHOLDER',
  })
  if (item.operation === 'set' && (typeof item.value !== 'string' || item.value === '')) {
    throw new Error('credential value must be a non-empty string')
  }
  return {
    operation: item.operation,
    owner: definition.owner,
    id: definition.id,
    version: definition.version,
    ...(item.operation === 'set' ? { value: item.value as string } : {}),
  }
})

const infoCodec = defineCodec<FabricCredentialInfo>(value => {
  const item = record(value, 'credential info')
  if (typeof item.configured !== 'boolean' || typeof item.writable !== 'boolean') throw new Error('credential info is invalid')
  if (item.source !== undefined && typeof item.source !== 'string') throw new Error('credential source is invalid')
  return {
    configured: item.configured,
    writable: item.writable,
    ...(typeof item.source === 'string' ? { source: item.source } : {}),
  }
})

export const fabricCredentialResource = defineResource<FabricCredentialRequest, FabricCredentialInfo>({
  owner: '@dsh-do/fabric',
  id: 'credentials',
  version: '1',
  scope: 'profile',
  request: requestCodec,
  response: infoCodec,
})
