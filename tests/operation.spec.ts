import { describe, expect, it, vi } from 'vitest'
import { defineCodec } from '../src/resource/contract.ts'
import { defineOperation, FabricOperationRegistry } from '../src/operation/contract.ts'

const stringCodec = defineCodec<string>(value => {
  if (typeof value !== 'string') throw new Error('expected string')
  return value
})
const progressCodec = defineCodec<{ current: number }>(value => {
  if (typeof value !== 'object' || value === null || typeof (value as { current?: unknown }).current !== 'number') {
    throw new Error('invalid progress')
  }
  return value as { current: number }
})
const importOperation = defineOperation({
  owner: '@example/importer',
  id: 'import',
  version: '1',
  input: stringCodec,
  result: stringCodec,
  progress: progressCodec,
})

describe('FabricOperationRegistry', () => {
  it('publishes progress and a typed result', async () => {
    const runtime = new FabricOperationRegistry()
    runtime.provide(importOperation, async (input, run) => {
      run.report({ current: 1 })
      await Promise.resolve()
      return input.toUpperCase()
    })
    const handle = runtime.start(importOperation, 'ready')
    const changed = vi.fn()
    handle.subscribe(changed)

    await expect(handle.result()).resolves.toBe('READY')
    expect(handle.getSnapshot()).toMatchObject({
      status: 'succeeded',
      progress: { current: 1 },
      result: 'READY',
    })
    expect(changed).toHaveBeenCalled()
  })

  it('cancels a running operation through its AbortSignal', async () => {
    const runtime = new FabricOperationRegistry()
    let signal!: AbortSignal
    runtime.provide(importOperation, async (_input, run) => {
      signal = run.signal
      await new Promise<void>((_resolve, reject) => {
        run.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      })
      return 'never'
    })
    const handle = runtime.start(importOperation, 'start')
    await Promise.resolve()
    handle.cancel()

    await expect(handle.result()).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal.aborted).toBe(true)
    expect(handle.getSnapshot().status).toBe('cancelled')
  })

  it('aborts active runs when their provider unloads', async () => {
    const runtime = new FabricOperationRegistry()
    const stop = runtime.provide(importOperation, async (_input, run) => {
      await new Promise<void>((_resolve, reject) => {
        run.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      })
      return 'never'
    })
    const handle = runtime.start(importOperation, 'start')
    await Promise.resolve()
    stop()
    await expect(handle.result()).rejects.toMatchObject({ name: 'AbortError' })
    expect(handle.getSnapshot().status).toBe('cancelled')
  })

  it('validates input before starting and rejects unavailable versions', () => {
    const runtime = new FabricOperationRegistry()
    runtime.provide(importOperation, async input => input)
    expect(() => runtime.start(importOperation, 3 as unknown as string)).toThrow(/expected string/)
    const v2 = defineOperation({ ...importOperation, version: '2' })
    expect(() => runtime.start(v2, 'input')).toThrow(/unavailable/)
  })
})
