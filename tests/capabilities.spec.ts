import { describe, expect, it, vi } from 'vitest'
import { defineCapability } from '../src/capability/contract.ts'
import { FabricCapabilityRegistry } from '../src/client/capabilities.ts'

const statusCapability = defineCapability<{ ping(): string }>({
  owner: '@example/status',
  id: 'status',
  version: '1',
  side: 'client',
})

describe('FabricCapabilityRegistry', () => {
  it('lets a consumer bind before the provider starts', () => {
    const registry = new FabricCapabilityRegistry()
    const binding = registry.consume(statusCapability)
    const changed = vi.fn()
    binding.subscribe(changed)

    expect(binding.getSnapshot()).toMatchObject({
      status: 'unavailable',
      value: undefined,
      availableVersions: [],
    })

    const provider = registry.provide(
      '@example/status',
      statusCapability,
      { ping: () => 'ok' },
      'generation-3',
    )
    expect(binding.getSnapshot()).toMatchObject({
      status: 'available',
      generation: 'generation-3',
    })
    expect(binding.getSnapshot().value?.ping()).toBe('ok')
    expect(changed).toHaveBeenCalledTimes(1)

    provider.dispose()
    expect(binding.getSnapshot().status).toBe('unavailable')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('revokes cached implementations before publishing provider removal', () => {
    const registry = new FabricCapabilityRegistry()
    const provider = registry.provide('@example/status', statusCapability, { ping: () => 'ok' })
    const binding = registry.consume(statusCapability)
    const cached = binding.getSnapshot().value
    expect(cached?.ping()).toBe('ok')

    provider.dispose()
    expect(() => cached?.ping()).toThrow(TypeError)
  })

  it('reports exact-version incompatibility without hiding available versions', () => {
    const registry = new FabricCapabilityRegistry()
    registry.provide('@example/status', statusCapability, { ping: () => 'v1' })
    const v2 = defineCapability<{ ping(): string }>({ ...statusCapability, version: '2' })
    expect(registry.consume(v2).getSnapshot()).toMatchObject({
      status: 'incompatible',
      value: undefined,
      availableVersions: ['1'],
    })
  })

  it('prevents owner spoofing and duplicate exact contracts', () => {
    const registry = new FabricCapabilityRegistry()
    expect(() => registry.provide('@other/provider', statusCapability, { ping: () => 'no' })).toThrow(/cannot provide/)
    registry.provide('@example/status', statusCapability, { ping: () => 'ok' })
    expect(() => registry.provide('@example/status', statusCapability, { ping: () => 'duplicate' })).toThrow(/already registered/)
  })

  it('releases disposed consumer bindings', () => {
    const registry = new FabricCapabilityRegistry()
    const binding = registry.consume(statusCapability)
    const changed = vi.fn()
    binding.subscribe(changed)
    binding.dispose()
    registry.provide('@example/status', statusCapability, { ping: () => 'ok' })
    expect(changed).not.toHaveBeenCalled()
    expect(binding.getSnapshot().status).toBe('unavailable')
  })
})
