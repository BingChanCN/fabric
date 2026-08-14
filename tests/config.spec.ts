import { describe, expect, it, vi } from 'vitest'
import { FabricHttpError } from '../src/sdk/http.ts'
import {
  ConfigStore, createConfigStore, defaultsFromSchema, isConfigId,
} from '../src/sdk/config.ts'
import type { ConfigCache, ConfigDocument, FabricConfigSchema } from '../src/sdk/config.ts'
import type { JsonClient, JsonValue } from '../src/sdk/http.ts'

const schema: FabricConfigSchema = {
  enabled: { type: 'boolean', title: 'Enabled', default: false },
  name: { type: 'string', title: 'Name', default: 'demo' },
  count: { type: 'number', title: 'Count', default: 1 },
}

function memoryCache(seed?: Record<string, ConfigDocument>): ConfigCache {
  const data = new Map(Object.entries(seed ?? {}))
  return {
    read: id => data.get(id),
    write: (id, document) => { data.set(id, document) },
    clear: id => { data.delete(id) },
  }
}

function mockClient(handlers: {
  get?: (path: string) => Promise<unknown>
  put?: (path: string, body: unknown) => Promise<unknown>
}): Pick<JsonClient, 'get' | 'put'> {
  return {
    get: path => handlers.get?.(path) as Promise<never>,
    put: (path, body) => handlers.put?.(path, body) as Promise<never>,
  }
}

describe('config schema', () => {
  it('accepts stable ids and rejects path-like ids', () => {
    expect(isConfigId('hello-fabric')).toBe(true)
    expect(isConfigId('../secret')).toBe(false)
    expect(isConfigId('a/b')).toBe(false)
  })

  it('fills defaults from the schema', () => {
    expect(defaultsFromSchema(schema)).toEqual({ enabled: false, name: 'demo', count: 1 })
  })
})

describe('ConfigStore', () => {
  it('hydrates from cache before the first GET and does not let GET overwrite dirty keys', async () => {
    const cache = memoryCache({
      demo: { id: 'demo', seq: 2, values: { enabled: true, name: 'cached', count: 1 } },
    })
    let getCount = 0
    const store = createConfigStore({
      id: 'demo',
      schema,
      cache,
      debounceMs: 10_000,
      client: mockClient({
        get: async () => {
          getCount += 1
          return { id: 'demo', seq: 4, values: { enabled: false, name: 'remote', count: 9 } }
        },
      }),
    })

    expect(store.getSnapshot().values).toEqual({ enabled: true, name: 'cached', count: 1 })
    expect(store.getSnapshot().seq).toBe(2)

    store.set({ name: 'local' })
    await store.load()

    expect(getCount).toBe(1)
    expect(store.getSnapshot().values).toEqual({ enabled: false, name: 'local', count: 9 })
    expect(store.getSnapshot().seq).toBe(4)
    expect(store.getSnapshot().dirty).toBe(true)
    store.dispose()
  })

  it('retries a 409 while keeping dirty fields and advancing seq', async () => {
    const puts: Array<{ seq: number; values: Record<string, JsonValue> }> = []
    const store = new ConfigStore({
      id: 'demo',
      schema,
      debounceMs: 10_000,
      client: mockClient({
        put: async (_path, body) => {
          const payload = body as { seq: number; values: Record<string, JsonValue> }
          puts.push(payload)
          if (payload.seq === 0) {
            throw new FabricHttpError('conflict', {
              status: 409,
              statusText: 'Conflict',
              url: '/fabric/config/demo',
              details: { id: 'demo', seq: 3, values: { enabled: true, name: 'server', count: 4 } },
            })
          }
          return { id: 'demo', seq: payload.seq + 1, values: payload.values }
        },
      }),
    })

    store.set({ name: 'mine' })
    await store.persist()

    expect(puts).toHaveLength(2)
    expect(puts[0]?.seq).toBe(0)
    expect(puts[1]?.seq).toBe(3)
    expect(puts[1]?.values.name).toBe('mine')
    expect(store.getSnapshot().values).toEqual({ enabled: true, name: 'mine', count: 4 })
    expect(store.getSnapshot().seq).toBe(4)
    expect(store.getSnapshot().dirty).toBe(false)
    expect(store.getSnapshot().status).toBe('ready')
    store.dispose()
  })

  it('reset restores the last persisted document', async () => {
    const store = createConfigStore({
      id: 'demo',
      schema,
      client: mockClient({
        put: async (_path, body) => {
          const payload = body as ConfigDocument
          return { id: 'demo', seq: payload.seq + 1, values: payload.values }
        },
      }),
    })
    store.set({ enabled: true })
    await store.persist()
    store.set({ name: 'draft' })
    expect(store.getSnapshot().dirty).toBe(true)
    store.reset()
    expect(store.getSnapshot().values.name).toBe('demo')
    expect(store.getSnapshot().values.enabled).toBe(true)
    expect(store.getSnapshot().dirty).toBe(false)
    store.dispose()
  })
})
