import { describe, expect, it } from 'vitest'
import { FabricCapabilityRegistry } from '../src/client/capabilities.ts'

describe('FabricCapabilityRegistry', () => {
  it('registers, reads, and forgets a capability', () => {
    const registry = new FabricCapabilityRegistry()
    const stop = registry.register('hello-status', { ping: () => 'ok' })
    expect(registry.get<{ ping: () => string }>('hello-status')?.ping()).toBe('ok')
    expect(registry.list()).toEqual(['hello-status'])
    stop()
    expect(registry.get('hello-status')).toBeUndefined()
  })

  it('rejects a duplicate id', () => {
    const registry = new FabricCapabilityRegistry()
    registry.register('dup', {})
    expect(() => registry.register('dup', {})).toThrow(/already registered/)
    registry.dispose()
    expect(registry.list()).toEqual([])
  })
})
