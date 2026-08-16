import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FabricRuntimeClientReconciler } from '../src/client/runtime.ts'

interface FakeSource {
  onmessage: ((event: { readonly data: string }) => void) | null
  onerror: (() => void) | null
  close(): void
  emit(value: unknown): void
}

function source(): FakeSource {
  return {
    onmessage: null,
    onerror: null,
    close: vi.fn(),
    emit(value) {
      this.onmessage?.({ data: JSON.stringify(value) })
    },
  }
}

function context() {
  const modules = {
    loadCache: new Map<string, { styles: readonly string[] }>(),
    invalidated: [] as string[],
    invalidate(id: string) {
      this.invalidated.push(id)
      this.loadCache.delete(id)
    },
  }
  const entries = new Map<string, { fiber: { await(): Promise<void> } }>()
  let nextEntry = 0
  const loader = {
    created: [] as Array<{ name: string; config?: unknown }>,
    removed: [] as string[],
    async create(options: { name: string; config?: unknown }) {
      const id = `entry-${++nextEntry}`
      this.created.push(options)
      entries.set(id, { fiber: { await: async () => {} } })
      return id
    },
    resolve(id: string) {
      const entry = entries.get(id)
      if (entry === undefined) throw new Error(`missing ${id}`)
      return entry
    },
    async remove(id: string) {
      this.removed.push(id)
      entries.delete(id)
    },
  }
  const ctx = {
    get(name: string) {
      if (name === 'modules') return modules
      if (name === 'loader') return loader
      throw new Error(`unknown service ${name}`)
    },
  } as unknown as Context
  return { ctx, modules, loader }
}

const inventory = (revision: number, plugins: Record<string, { version: string; enabled: boolean; source?: string }>) => ({
  format: 1,
  revision,
  plugins: Object.fromEntries(Object.entries(plugins).map(([name, entry]) => [name, {
    ...entry,
    source: entry.source ?? `file:/${name}`,
  }])),
})

describe('FabricRuntimeClientReconciler', () => {
  it('keeps the external-store snapshot reference stable until a status changes', () => {
    const { ctx } = context()
    const reconciler = new FabricRuntimeClientReconciler(ctx)
    expect(reconciler.getSnapshot()).toBe(reconciler.getSnapshot())
  })

  it('reconciles one tab and retracts its entry and styles', async () => {
    const { ctx, modules, loader } = context()
    const events = source()
    const bundles: string[] = []
    const statusReports: Array<Record<string, unknown>> = []
    let eventSourceUrl = ''
    const reconciler = new FabricRuntimeClientReconciler(ctx, {
      fetch: async (_input, init) => {
        if (init?.method === 'POST') statusReports.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)
        return { ok: true, status: 200, json: async () => inventory(1, {
          '@example/weather': { version: '1.0.0', enabled: true },
        }) }
      },
      loadBundle: async url => {
        bundles.push(url)
        modules.loadCache.set('fabric-runtime/%40example%2Fweather', { styles: ['weather.css'] })
      },
      createEventSource: url => {
        eventSourceUrl = url
        return events
      },
    })

    await reconciler.start()
    expect(loader.created.map(entry => entry.name)).toEqual(['fabric-runtime/%40example%2Fweather'])
    expect(loader.created[0]?.config).toMatchObject({
      fabricRuntime: { generation: '1', clientId: expect.any(String) },
    })
    expect(bundles[0]).toContain('/%40example%2Fweather/1.0.0/client.js?generation=1')
    expect(eventSourceUrl).toMatch(/clientId=/)
    expect(reconciler.getSnapshot()).toEqual([{
      packageName: '@example/weather', version: '1.0.0', generation: '1', status: 'active',
    }])

    events.emit(inventory(2, {}))
    await vi.waitFor(() => expect(loader.removed).toHaveLength(1))
    expect(modules.invalidated).toEqual([
      'fabric-runtime/%40example%2Fweather',
      'fabric-runtime/%40example%2Fweather',
    ])
    await vi.waitFor(() => expect(reconciler.getSnapshot()).toEqual([]))
    await vi.waitFor(() => expect(statusReports).toContainEqual(expect.objectContaining({
      packageName: '@example/weather', generation: '2', status: 'inactive',
    })))
    await reconciler.dispose()
  })

  it('reloads the same version when a dev overlay source changes', async () => {
    const { ctx, loader } = context()
    const events = source()
    const bundles: string[] = []
    const reconciler = new FabricRuntimeClientReconciler(ctx, {
      fetch: async () => ({ ok: true, status: 200, json: async () => inventory(1, {
        '@example/weather': { version: '1.0.0', enabled: true, source: 'dev:lease.1' },
      }) }),
      loadBundle: async url => { bundles.push(url) },
      createEventSource: () => events,
    })

    await reconciler.start()
    events.emit(inventory(2, {
      '@example/weather': { version: '1.0.0', enabled: true, source: 'dev:lease.2' },
    }))
    await vi.waitFor(() => expect(loader.created).toHaveLength(2))

    expect(loader.removed).toEqual(['entry-1'])
    expect(bundles).toEqual([
      '/fabric/runtime/packages/%40example%2Fweather/1.0.0/client.js?generation=1',
      '/fabric/runtime/packages/%40example%2Fweather/1.0.0/client.js?generation=2',
    ])
    await reconciler.dispose()
  })

  it('contains a client fiber failure to the package status', async () => {
    const { ctx, loader } = context()
    const originalResolve = loader.resolve
    loader.resolve = (id: string) => ({
      fiber: { await: async () => { throw new Error('client boot failed') } },
    })
    const reconciler = new FabricRuntimeClientReconciler(ctx, {
      fetch: async () => ({ ok: true, status: 200, json: async () => inventory(1, {
        '@example/broken': { version: '1.0.0', enabled: true },
      }) }),
      loadBundle: async () => {},
      createEventSource: () => source(),
    })

    await reconciler.start()
    expect(reconciler.getSnapshot()).toEqual([{
      packageName: '@example/broken', version: '1.0.0', generation: '1', status: 'failed', error: 'client boot failed',
    }])
    expect(loader.removed).toEqual(['entry-1'])
    loader.resolve = originalResolve
    await reconciler.retry('@example/broken')
    expect(reconciler.getSnapshot()).toEqual([{
      packageName: '@example/broken', version: '1.0.0', generation: '1', status: 'active',
    }])
    expect(loader.created).toHaveLength(2)
    await reconciler.dispose()
  })

  it('does not activate a bundle that finishes loading after its tab is disposed', async () => {
    const { ctx, modules, loader } = context()
    let release!: () => void
    const loading = new Promise<void>(resolve => { release = resolve })
    const reconciler = new FabricRuntimeClientReconciler(ctx, {
      fetch: async () => ({ ok: true, status: 200, json: async () => inventory(1, {
        '@example/slow': { version: '1.0.0', enabled: true },
      }) }),
      loadBundle: async () => loading,
      createEventSource: () => source(),
    })

    const starting = reconciler.start()
    await vi.waitFor(() => expect(reconciler.getSnapshot()[0]?.status).toBe('loading'))
    await reconciler.dispose()
    release()
    await starting

    expect(loader.created).toEqual([])
    expect(modules.invalidated).toEqual([
      'fabric-runtime/%40example%2Fslow',
      'fabric-runtime/%40example%2Fslow',
    ])
    expect(reconciler.getSnapshot()).toEqual([])
  })
})
