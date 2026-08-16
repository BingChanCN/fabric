import type { Observable } from '../sdk/observable.ts'

/** Runtime side on which a capability is provided and consumed. */
export type FabricCapabilitySide = 'host' | 'client'

/**
 * A cross-plugin capability identity. The owner is the provider package's
 * canonical npm name; it is never inferred from a caller-supplied short id.
 */
export interface FabricCapabilityDefinition<T extends object = object> {
  readonly owner: string
  readonly id: string
  readonly version: string
  readonly side: FabricCapabilitySide
  readonly valueType?: T
}

export type FabricCapabilityStatus = 'available' | 'unavailable' | 'incompatible'

export interface FabricCapabilitySnapshot<T extends object = object> {
  readonly status: FabricCapabilityStatus
  readonly value: T | undefined
  readonly owner: string
  readonly id: string
  readonly version: string
  readonly availableVersions: readonly string[]
  readonly generation: string | undefined
}

export interface FabricCapabilityBinding<T extends object = object> extends Observable<FabricCapabilitySnapshot<T>> {
  readonly definition: FabricCapabilityDefinition<T>
  dispose(): void
}

export interface FabricCapabilityProviderHandle<T extends object = object> {
  readonly definition: FabricCapabilityDefinition<T>
  readonly generation: string
  dispose(): void
}

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/u
const CONTRACT_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u

export function defineCapability<T extends object>(
  definition: FabricCapabilityDefinition<T>,
): FabricCapabilityDefinition<T> {
  if (!PACKAGE_NAME.test(definition.owner)) {
    throw new Error(`fabric capability owner "${definition.owner}" is invalid`)
  }
  if (!CONTRACT_ID.test(definition.id)) {
    throw new Error(`fabric capability id "${definition.id}" is invalid`)
  }
  if (definition.version.trim() === '') {
    throw new Error(`fabric capability "${definition.owner}/${definition.id}" version is empty`)
  }
  return Object.freeze({ ...definition })
}

export function capabilityKey(definition: FabricCapabilityDefinition): string {
  return `${definition.side}:${definition.owner}:${definition.id}:${definition.version}`
}

export function capabilityFamilyKey(definition: FabricCapabilityDefinition): string {
  return `${definition.side}:${definition.owner}:${definition.id}`
}
