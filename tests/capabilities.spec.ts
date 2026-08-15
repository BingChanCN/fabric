import { describe, expect, it } from 'vitest'
import { FabricCapabilityRegistry } from '../src/client/capabilities.ts'

describe('FabricCapabilityRegistry', () => {
  it('registers, reads, and forgets a capability', () => {
    const registry = new FabricCapabilityRegistry()
    const stop = registry.register('hello-status', '1', 'profile', { ping: () => 'ok' })
    expect(registry.get<{ ping: () => string }>('hello-status', '1')?.ping()).toBe('ok')
    expect(registry.list()).toEqual(['hello-status@1'])
    stop()
    expect(registry.get('hello-status')).toBeUndefined()
  })

  it('rejects a duplicate id', () => {
    const registry = new FabricCapabilityRegistry()
    registry.register('dup', '1', 'profile', {})
    expect(() => registry.register('dup', '1', 'profile', {})).toThrow(/already registered/)
    registry.dispose()
    expect(registry.list()).toEqual([])
  })
})
