import { describe, expect, it } from 'vitest'
import { FabricResourceError } from '../src/resource/contract.ts'
import {
  ConfigStore, createConfigStore, defaultsFromSchema, isConfigId,
} from '../src/sdk/config.ts'
import type { ConfigCache, ConfigDocument, ConfigResourceTransport, FabricConfigSchema } from '../src/sdk/config.ts'
import type { JsonValue } from '../src/sdk/json.ts'

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

function mockTransport(handlers: {
  read?: (id: string, schema: FabricConfigSchema) => Promise<ConfigDocument>
  write?: (id: string, seq: number, values: JsonValue, schema: FabricConfigSchema) => Promise<ConfigDocument>
}): ConfigResourceTransport {
  return {
    read: (id, schema) => handlers.read?.(id, schema) as Promise<ConfigDocument>,
    write: (id, seq, values, schema) => handlers.write?.(id, seq, values, schema) as Promise<ConfigDocument>,
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
  it('hydrates from cache before the first read and does not let read overwrite dirty keys', async () => {
    const cache = memoryCache({
      demo: { id: 'demo', seq: 2, values: { enabled: true, name: 'cached', count: 1 } },
    })
    let readCount = 0
    const store = createConfigStore({
      id: 'demo',
      schema,
      cache,
      debounceMs: 10_000,
      resource: mockTransport({
        read: async () => {
          readCount += 1
          return { id: 'demo', seq: 4, values: { enabled: false, name: 'remote', count: 9 } }
        },
      }),
    })

    expect(store.getSnapshot().values).toEqual({ enabled: true, name: 'cached', count: 1 })
    expect(store.getSnapshot().seq).toBe(2)

    store.set({ name: 'local' })
    await store.load()

    expect(readCount).toBe(1)
    expect(store.getSnapshot().values).toEqual({ enabled: false, name: 'local', count: 9 })
    expect(store.getSnapshot().seq).toBe(4)
    expect(store.getSnapshot().dirty).toBe(true)
    store.dispose()
  })

  it('retries a config-conflict while keeping dirty fields and advancing seq', async () => {
    const writes: Array<{ seq: number; values: JsonValue }> = []
    const store = new ConfigStore({
      id: 'demo',
      schema,
      debounceMs: 10_000,
      resource: mockTransport({
        write: async (_id, seq, values) => {
          writes.push({ seq, values })
          if (seq === 0) {
            throw new FabricResourceError({
              code: 'config-conflict',
              message: 'changed on the host',
              details: { id: 'demo', seq: 3, values: { enabled: true, name: 'server', count: 4 } },
              retryable: true,
            })
          }
          return { id: 'demo', seq: seq + 1, values: values as Record<string, JsonValue> }
        },
      }),
    })

    store.set({ name: 'mine' })
    await store.persist()

    expect(writes).toHaveLength(2)
    expect(writes[0]?.seq).toBe(0)
    expect(writes[1]?.seq).toBe(3)
    expect((writes[1]?.values as Record<string, JsonValue>).name).toBe('mine')
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
      resource: mockTransport({
        write: async (_id, seq, values) => ({ id: 'demo', seq: seq + 1, values: values as Record<string, JsonValue> }),
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
