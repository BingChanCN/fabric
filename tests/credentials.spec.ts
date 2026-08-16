import { describe, expect, it, vi } from 'vitest'
import { defineCredential } from '../src/credential/contract.ts'
import { FabricCredentialService } from '../src/host/credentials.ts'

const apiKey = defineCredential({
  owner: '@example/importer',
  id: 'api-key',
  version: '1',
  ref: 'EXAMPLE_API_KEY',
})

describe('Fabric Credential adapter', () => {
  it('declares owner-scoped refs, resolves on every operation, and never exposes values from describe', async () => {
    let value = 'first'
    const provider = {
      resolve: vi.fn(async () => ({ value, source: 'file' })),
      describe: vi.fn(async () => ({ configured: value !== '', source: 'file', writable: true })),
      set: vi.fn(async (_ref: string, next: string) => { value = next }),
      unset: vi.fn(async () => { value = '' }),
    }
    const service = new FabricCredentialService(provider)
    const dispose = service.declare('@example/importer', apiKey)

    await expect(service.resolve('@example/importer', apiKey)).resolves.toEqual({ value: 'first', source: 'file' })
    value = 'second'
    await expect(service.resolve('@example/importer', apiKey)).resolves.toEqual({ value: 'second', source: 'file' })
    expect(await service.describeIdentity(apiKey.owner, apiKey.id, apiKey.version)).toEqual({
      configured: true, source: 'file', writable: true,
    })
    await service.set(apiKey.owner, apiKey.id, apiKey.version, 'third')
    expect(value).toBe('third')
    await service.unset(apiKey.owner, apiKey.id, apiKey.version)
    expect(value).toBe('')
    expect(provider.resolve).toHaveBeenCalledTimes(2)

    dispose()
    await expect(service.describeIdentity(apiKey.owner, apiKey.id, apiKey.version)).rejects.toMatchObject({
      code: 'credential-unavailable',
    })
  })

  it('rejects owner impersonation and exact-version mismatches', async () => {
    const provider = {
      resolve: vi.fn(), describe: vi.fn(), set: vi.fn(), unset: vi.fn(),
    }
    const service = new FabricCredentialService(provider)
    expect(() => service.declare('@example/other', apiKey)).toThrow(/cannot declare/)
    service.declare(apiKey.owner, apiKey)
    await expect(service.describeIdentity(apiKey.owner, apiKey.id, '2')).rejects.toMatchObject({
      code: 'credential-version-mismatch',
    })
  })
})
