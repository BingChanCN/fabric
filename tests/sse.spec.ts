import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventStream } from '../src/sdk/sse.ts'
import type { EventSourceLike } from '../src/sdk/sse.ts'

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Set<EventListener>>()
  readonly close = vi.fn()

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

afterEach(() => { vi.useRealTimers() })

describe('EventStream', () => {
  it('parses events and reconnects with reset backoff after an open connection', () => {
    vi.useFakeTimers()
    const sources: FakeEventSource[] = []
    const stream = new EventStream<{ count: number }>({
      url: () => '/events',
      minRetryMs: 100,
      maxRetryMs: 800,
      createEventSource: () => {
        const source = new FakeEventSource()
        sources.push(source)
        return source
      },
    })

    stream.start()
    expect(stream.getSnapshot()).toMatchObject({ status: 'connecting', reconnectAttempt: 0 })
    sources[0]?.emit('open')
    sources[0]?.emit('message', new MessageEvent('message', { data: '{"count":1}' }))
    expect(stream.getSnapshot()).toMatchObject({ status: 'open', latest: { count: 1 } })

    sources[0]?.emit('error')
    expect(stream.getSnapshot()).toMatchObject({ status: 'error', reconnectAttempt: 1 })
    vi.advanceTimersByTime(100)
    expect(sources).toHaveLength(2)
    expect(stream.getSnapshot()).toMatchObject({ status: 'connecting', reconnectAttempt: 1 })

    sources[1]?.emit('open')
    sources[1]?.emit('error')
    expect(stream.getSnapshot().reconnectAttempt).toBe(1)
    stream.stop()
    vi.advanceTimersByTime(1000)
    expect(sources).toHaveLength(2)
    expect(stream.getSnapshot().status).toBe('closed')
  })

  it('surfaces malformed event payloads without losing the transport', () => {
    const source = new FakeEventSource()
    const stream = new EventStream({ url: '/events', createEventSource: () => source })
    stream.start()
    source.emit('open')
    source.emit('message', new MessageEvent('message', { data: 'not json' }))
    expect(stream.getSnapshot().status).toBe('error')
    expect(stream.getSnapshot().error).toBeInstanceOf(SyntaxError)
    expect(source.close).not.toHaveBeenCalled()
    stream.dispose()
    expect(source.close).toHaveBeenCalledOnce()
  })
})
