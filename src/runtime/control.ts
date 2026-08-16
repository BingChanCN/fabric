import { defineOperation, type FabricOperationDefinition } from '../operation/contract.ts'
import { defineCodec, defineResource, voidCodec } from '../resource/contract.ts'
import type { FabricInventory, FabricInventoryEntry } from './inventory.ts'
import { isFabricPackageName } from './identity.ts'

export const FABRIC_CORE_PACKAGE = '@dsh-do/fabric'

export type FabricPackageOperationStage =
  | 'resolving'
  | 'downloading'
  | 'validating'
  | 'staging'
  | 'stopping-client'
  | 'stopping-host'
  | 'starting-host'
  | 'committing'
  | 'starting-client'
  | 'completed'

export interface FabricPackageOperationProgress {
  readonly stage: FabricPackageOperationStage
}

export interface FabricInstallPackageInput {
  readonly source: string
}

export interface FabricPackageNameInput {
  readonly name: string
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

const progressCodec = defineCodec<FabricPackageOperationProgress>(value => {
  const item = record(value, 'package operation progress')
  const stage = item.stage
  const stages: readonly FabricPackageOperationStage[] = [
    'resolving', 'downloading', 'validating', 'staging', 'stopping-client', 'stopping-host',
    'starting-host', 'committing', 'starting-client', 'completed',
  ]
  if (typeof stage !== 'string' || !stages.includes(stage as FabricPackageOperationStage)) {
    throw new Error('package operation stage is invalid')
  }
  return { stage: stage as FabricPackageOperationStage }
})

const installPackageCodec = defineCodec<FabricInstallPackageInput>(value => {
  const item = record(value, 'install input')
  if (typeof item.source !== 'string' || item.source.trim() === '') throw new Error('install source is empty')
  return { source: item.source }
})

const packageNameCodec = defineCodec<FabricPackageNameInput>(value => {
  const item = record(value, 'package input')
  if (typeof item.name !== 'string' || !isFabricPackageName(item.name)) throw new Error('package name is invalid')
  return { name: item.name }
})

function parseInventoryEntry(value: unknown, label = 'package inventory entry'): FabricInventoryEntry {
  const item = record(value, label)
  if (typeof item.version !== 'string' || item.version === '' || typeof item.source !== 'string' || item.source === '' || typeof item.enabled !== 'boolean') {
    throw new Error(`${label} is invalid`)
  }
  let previous: FabricInventoryEntry['previous']
  if (item.previous !== undefined) {
    const rawPrevious = record(item.previous, `${label} previous`)
    if (typeof rawPrevious.version !== 'string' || rawPrevious.version === '' || typeof rawPrevious.source !== 'string' || rawPrevious.source === '') {
      throw new Error(`${label} previous is invalid`)
    }
    previous = { version: rawPrevious.version, source: rawPrevious.source }
  }
  return { version: item.version, source: item.source, enabled: item.enabled, ...(previous === undefined ? {} : { previous }) }
}

const entryCodec = defineCodec<FabricInventoryEntry>(parseInventoryEntry)

function operation<Input, Result>(
  id: string,
  input: ReturnType<typeof defineCodec<Input>>,
  result: ReturnType<typeof defineCodec<Result>>,
): FabricOperationDefinition<Input, Result, FabricPackageOperationProgress> {
  return defineOperation({
    owner: FABRIC_CORE_PACKAGE,
    id,
    version: '1',
    input,
    result,
    progress: progressCodec,
  })
}

export const fabricInstallPackageOperation = operation('packages.install', installPackageCodec, entryCodec)
export const fabricUpdatePackageOperation = operation('packages.update', packageNameCodec, entryCodec)
export const fabricEnablePackageOperation = operation('packages.enable', packageNameCodec, entryCodec)
export const fabricDisablePackageOperation = operation('packages.disable', packageNameCodec, entryCodec)
export const fabricRollbackPackageOperation = operation('packages.rollback', packageNameCodec, entryCodec)
export const fabricRemovePackageOperation = operation('packages.remove', packageNameCodec, voidCodec)
export const fabricPurgePackageOperation = operation('packages.purge', packageNameCodec, voidCodec)

const inventoryRequestCodec = defineCodec<Record<string, never>>(value => {
  const item = record(value, 'package inventory request')
  if (Object.keys(item).length !== 0) throw new Error('package inventory request must be empty')
  return {}
})
const inventoryCodec = defineCodec<FabricInventory>(value => {
  const item = record(value, 'package inventory')
  if (item.format !== 1 || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 0) {
    throw new Error('package inventory header is invalid')
  }
  const rawPlugins = record(item.plugins, 'package inventory plugins')
  const plugins: Record<string, FabricInventoryEntry> = {}
  for (const [name, rawEntry] of Object.entries(rawPlugins)) {
    if (!isFabricPackageName(name)) throw new Error(`package inventory name "${name}" is invalid`)
    plugins[name] = parseInventoryEntry(rawEntry, `package inventory entry "${name}"`)
  }
  return { format: 1, revision: item.revision, plugins }
})

export const fabricPackageInventoryResource = defineResource<Record<string, never>, FabricInventory>({
  owner: FABRIC_CORE_PACKAGE,
  id: 'runtime-packages',
  version: '1',
  scope: 'profile',
  request: inventoryRequestCodec,
  response: inventoryCodec,
})
