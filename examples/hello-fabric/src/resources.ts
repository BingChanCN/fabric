import { defineCodec, defineResource, voidCodec } from '@dsh-do/fabric/contracts'

export interface ExampleStatus {
  readonly status: 'ok'
  readonly enabled: boolean
}

export interface ExampleSettingsRequest { readonly enabled: boolean }
export interface ExampleSettingsResponse { readonly saved: true; readonly enabled: boolean }

const statusCodec = defineCodec<ExampleStatus>(value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid example status')
  const item = value as Record<string, unknown>
  if (item.status !== 'ok' || typeof item.enabled !== 'boolean') throw new Error('invalid example status')
  return { status: 'ok', enabled: item.enabled }
})

const settingsRequestCodec = defineCodec<ExampleSettingsRequest>(value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as { enabled?: unknown }).enabled !== 'boolean') {
    throw new Error('enabled must be boolean')
  }
  return value as ExampleSettingsRequest
})

const settingsResponseCodec = defineCodec<ExampleSettingsResponse>(value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as { saved?: unknown }).saved !== true || typeof (value as { enabled?: unknown }).enabled !== 'boolean') {
    throw new Error('invalid example settings response')
  }
  return value as ExampleSettingsResponse
})

export const statusResource = defineResource<void, ExampleStatus>({
  owner: 'hello-fabric', id: 'status', version: '1', scope: 'profile', request: voidCodec, response: statusCodec,
})

export const settingsResource = defineResource<ExampleSettingsRequest, ExampleSettingsResponse>({
  owner: 'hello-fabric', id: 'settings', version: '1', scope: 'profile', request: settingsRequestCodec, response: settingsResponseCodec,
})
