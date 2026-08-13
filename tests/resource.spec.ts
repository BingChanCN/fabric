import { describe, expect, it, vi } from 'vitest'
import { AsyncResource } from '../src/sdk/resource.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

describe('AsyncResource', () => {
  it('keeps only the latest load result and aborts the previous signal', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const signals: AbortSignal[] = []
    const loader = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? first.promise : second.promise
    })
    const resource = new AsyncResource(loader)

    const firstLoad = resource.load()
    const secondLoad = resource.load()
    expect(signals[0]?.aborted).toBe(true)
    expect(resource.getSnapshot()).toMatchObject({ status: 'loading', hasValue: false })

    first.resolve('old')
    await firstLoad
    expect(resource.getSnapshot().hasValue).toBe(false)

    second.resolve('new')
    await secondLoad
    expect(resource.getSnapshot()).toMatchObject({ status: 'ready', value: 'new', hasValue: true })
  })

  it('preserves stale data while refreshing and exposes refresh errors', async () => {
    const refresh = deferred<string>()
    let call = 0
    const resource = new AsyncResource(() => ++call === 1 ? Promise.resolve('cached') : refresh.promise)
    await resource.load()

    const loading = resource.load()
    expect(resource.getSnapshot()).toMatchObject({
      status: 'ready',
      value: 'cached',
      hasValue: true,
      refreshing: true,
    })
    refresh.reject(new Error('offline'))
    await loading
    expect(resource.getSnapshot()).toMatchObject({
      status: 'error',
      value: 'cached',
      hasValue: true,
      refreshing: false,
    })
    expect(resource.getSnapshot().error?.message).toBe('offline')
  })

  it('cancels an active request without surfacing an error', async () => {
    const pending = deferred<string>()
    let signal: AbortSignal | undefined
    const resource = new AsyncResource((nextSignal) => {
      signal = nextSignal
      return pending.promise
    })
    const loading = resource.load()
    resource.cancel()

    expect(signal?.aborted).toBe(true)
    expect(resource.getSnapshot()).toMatchObject({ status: 'idle', error: undefined })
    pending.reject(new DOMException('aborted', 'AbortError'))
    await loading
    expect(resource.getSnapshot()).toMatchObject({ status: 'idle', error: undefined })
  })
})
