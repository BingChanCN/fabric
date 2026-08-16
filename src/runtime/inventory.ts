import { valid } from 'semver'
import { isFabricPackageName } from './manifest.ts'

export const FABRIC_INVENTORY_FORMAT = 1 as const

export interface FabricInventoryVersion {
  readonly version: string
  readonly source: string
}

export interface FabricInventoryEntry extends FabricInventoryVersion {
  readonly enabled: boolean
  readonly previous?: FabricInventoryVersion
}

export interface FabricInventory {
  readonly format: typeof FABRIC_INVENTORY_FORMAT
  readonly revision: number
  readonly plugins: Readonly<Record<string, FabricInventoryEntry>>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function inventoryVersion(value: unknown, label: string): FabricInventoryVersion {
  const item = record(value, label)
  if (typeof item.version !== 'string' || valid(item.version) === null) throw new Error(`${label} has an invalid version`)
  if (typeof item.source !== 'string' || item.source.trim() === '' || /[\u0000\r\n]/u.test(item.source)) {
    throw new Error(`${label} has an invalid source`)
  }
  return Object.freeze({ version: item.version, source: item.source })
}

/** Parse the only durable desired-state document used by Fabric Runtime. */
export function parseFabricInventory(value: unknown): FabricInventory {
  const raw = record(value, 'fabric inventory')
  if (raw.format !== FABRIC_INVENTORY_FORMAT) throw new Error(`unsupported Fabric inventory format "${String(raw.format)}"`)
  if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw new Error('fabric inventory revision must be a non-negative integer')
  }
  const rawPlugins = record(raw.plugins, 'fabric inventory plugins')
  const plugins: Record<string, FabricInventoryEntry> = {}
  for (const [name, value] of Object.entries(rawPlugins)) {
    if (!isFabricPackageName(name)) throw new Error(`fabric inventory package "${name}" is invalid`)
    const label = `fabric inventory package "${name}"`
    const item = record(value, label)
    const current = inventoryVersion(item, label)
    if (typeof item.enabled !== 'boolean') throw new Error(`${label} enabled must be boolean`)
    const previous = item.previous === undefined ? undefined : inventoryVersion(item.previous, `${label} previous`)
    if (previous?.version === current.version) throw new Error(`${label} previous version must differ from current`)
    plugins[name] = Object.freeze({
      ...current,
      enabled: item.enabled,
      ...(previous === undefined ? {} : { previous }),
    })
  }
  return Object.freeze({
    format: FABRIC_INVENTORY_FORMAT,
    revision: raw.revision,
    plugins: Object.freeze(plugins),
  })
}

export function emptyFabricInventory(): FabricInventory {
  return Object.freeze({
    format: FABRIC_INVENTORY_FORMAT,
    revision: 0,
    plugins: Object.freeze({}),
  })
}
