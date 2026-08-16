import { defineCodec, defineResource } from './contract.ts'
import { parseConfigSchema, type FabricConfigSchema, type JsonRecord } from '../sdk/config.ts'

export type FabricConfigValues = JsonRecord

export interface FabricConfigReadRequest {
  readonly operation: 'read'
  readonly owner: string
  readonly id: string
  readonly schema: FabricConfigSchema
}

export interface FabricConfigWriteRequest {
  readonly operation: 'write'
  readonly owner: string
  readonly id: string
  readonly seq: number
  readonly values: FabricConfigValues
  readonly schema: FabricConfigSchema
}

export type FabricConfigRequest = FabricConfigReadRequest | FabricConfigWriteRequest

export interface FabricConfigDocument {
  readonly id: string
  readonly seq: number
  readonly values: FabricConfigValues
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

const valuesCodec = defineCodec<FabricConfigValues>(value => {
  const item = record(value, 'config values')
  return item as FabricConfigValues
})

export const configRequestCodec = defineCodec<FabricConfigRequest>(value => {
  const item = record(value, 'config request')
  if (item.operation === 'read') {
    if (typeof item.owner !== 'string' || item.owner.trim() === '') throw new Error('config owner must be a non-empty string')
    if (typeof item.id !== 'string' || item.id.trim() === '') throw new Error('config id must be a non-empty string')
    return { operation: 'read', owner: item.owner, id: item.id, schema: parseConfigSchema(item.schema) }
  }
  if (item.operation === 'write') {
    if (typeof item.owner !== 'string' || item.owner.trim() === '') throw new Error('config owner must be a non-empty string')
    if (typeof item.id !== 'string' || item.id.trim() === '') throw new Error('config id must be a non-empty string')
    if (typeof item.seq !== 'number' || !Number.isFinite(item.seq) || item.seq < 0) throw new Error('config seq must be non-negative')
    return { operation: 'write', owner: item.owner, id: item.id, seq: item.seq, values: valuesCodec.parse(item.values), schema: parseConfigSchema(item.schema) }
  }
  throw new Error('config operation must be read or write')
})

export const configDocumentCodec = defineCodec<FabricConfigDocument>(value => {
  const item = record(value, 'config document')
  if (typeof item.id !== 'string' || typeof item.seq !== 'number' || !Number.isFinite(item.seq) || item.seq < 0) {
    throw new Error('invalid config document')
  }
  return { id: item.id, seq: item.seq, values: valuesCodec.parse(item.values) }
})

export const fabricConfigResource = defineResource<FabricConfigRequest, FabricConfigDocument>({
  owner: '@dsh-do/fabric',
  id: 'config',
  version: '1',
  scope: 'profile',
  request: configRequestCodec,
  response: configDocumentCodec,
})
