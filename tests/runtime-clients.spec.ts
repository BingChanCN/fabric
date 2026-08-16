import { describe, expect, it } from 'vitest'
import { FabricRuntimeClientRegistry } from '../src/host/runtime-clients.ts'

describe('FabricRuntimeClientRegistry', () => {
  it('waits for every connected tab to retract the published generation', async () => {
    const clients = new FabricRuntimeClientRegistry()
    const disconnectA = clients.connect('client-a')
    const disconnectB = clients.connect('client-b')
    let settled = false
    const waiting = clients.waitForInactive('@example/weather', '7').then(() => { settled = true })

    clients.report({
      clientId: 'client-a', packageName: '@example/weather', version: '1.0.0', generation: '6', status: 'inactive',
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    clients.report({
      clientId: 'client-a', packageName: '@example/weather', version: '1.0.0', generation: '7', status: 'inactive',
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    disconnectB()
    await waiting
    expect(settled).toBe(true)
    disconnectA()
  })

  it('accepts an inactive report from a newer full snapshot', async () => {
    const clients = new FabricRuntimeClientRegistry()
    const disconnect = clients.connect('client-a')
    const waiting = clients.waitForInactive('@example/weather', '7')
    clients.report({
      clientId: 'client-a', packageName: '@example/weather', version: '1.0.0', generation: '9', status: 'inactive',
    })
    await expect(waiting).resolves.toBeUndefined()
    disconnect()
  })

  it('cancels an inactive wait without retaining a waiter', async () => {
    const clients = new FabricRuntimeClientRegistry()
    const disconnect = clients.connect('client-a')
    const controller = new AbortController()
    const waiting = clients.waitForInactive('@example/weather', '8', controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(waiting).rejects.toThrow('cancelled')
    disconnect()
  })
})
