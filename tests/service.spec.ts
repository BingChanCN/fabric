import { Context } from '@deepseek-ai/cordis'
import * as Cordis from '@deepseek-ai/cordis'
import * as SlotCoreModule from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry as SlotRegistryInstance } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import type {
  FabricOverlayProps, FabricPageProps, FabricSettingsProps, FabricToolbarActionProps,
} from '../src/client/contract.ts'
import { FabricConfigRegistry } from '../src/client/config-registry.ts'
import { FabricController } from '../src/client/controller.ts'
import { FabricRuntimeService } from '../src/client/service.ts'
import { FabricThemeManager } from '../src/client/theme.ts'
import { createJsonClient } from '../src/sdk/http.ts'

type RuntimeExports = {
  SlotRegistry: new (ctx: Context) => SlotRegistryInstance
}

type ModuleLoader = {
  load(definition: {
    id: string
    factory: (require: (id: string) => unknown) => unknown
  }): void
}

let runtimeExports: RuntimeExports | undefined
const modules: Record<string, unknown> = {
  '@deepseek-ai/cordis': Cordis,
  '@deepseek-ai/dsh-client-ui-slots': SlotCoreModule,
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __ModuleLoader__: {
      load(definition) {
        runtimeExports = definition.factory((id) => {
          if (!(id in modules)) throw new Error(`test module loader: unknown module "${id}"`)
          return modules[id]
        }) as RuntimeExports
      },
    } satisfies ModuleLoader,
  },
})
await import('@deepseek-ai/dsh-client-runtime/client')
if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
else Object.defineProperty(globalThis, 'window', previousWindow)
if (runtimeExports === undefined) throw new Error('test module loader: runtime bundle did not register')
const SlotRegistry = runtimeExports.SlotRegistry

const EmptyPage = (_props: FabricPageProps): null => null
const EmptyToolbar = (_props: FabricToolbarActionProps): null => null
const EmptyOverlay = (_props: FabricOverlayProps): null => null
const EmptySettings = (_props: FabricSettingsProps): null => null
const Root = (): null => null

interface ErasedSlots {
  register(options: object, component: unknown): () => void
  entries(key: string): readonly unknown[]
}

function emptyController(): FabricController {
  return new FabricController({
    read: () => [],
    subscribe: () => () => {},
  })
}

async function bootFabric(declareSlots: boolean): Promise<{
  ctx: Context
  slots: ErasedSlots
  declare: () => void
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.slots as unknown as ErasedSlots
  let declared = false
  const declare = (): void => {
    if (declared) return
    declared = true
    slots.register({
      name: 'root',
      children: {
        'fabric.page': { kind: 'list', scope: 'session-maybe' },
        'fabric.toolbar.action': { kind: 'list', scope: 'session-maybe' },
        'fabric.overlay': { kind: 'list', scope: 'session-maybe' },
        'fabric.settings': { kind: 'list', scope: 'root' },
      },
    }, Root)
  }
  if (declareSlots) declare()
  await ctx.plugin({
    name: 'fabric-service-test',
    inject: ['slots'],
    apply: (pluginCtx: Context) => {
      const configs = new FabricConfigRegistry(createJsonClient({
        fetch: async () => new Response(JSON.stringify({ id: 'x', seq: 0, values: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      }))
      pluginCtx.effect(() => () => { configs.dispose() }, 'test-registry')
      new FabricRuntimeService(pluginCtx, emptyController(), new FabricThemeManager(), configs)
    },
  }).await()
  return { ctx, slots, declare }
}

describe('FabricRuntimeService.register', () => {
  it('owns active contributions with the downstream plugin fiber', async () => {
    const { ctx, slots } = await bootFabric(true)
    const downstream = ctx.plugin({
      name: 'fabric-downstream-active',
      inject: ['fabric'],
      apply: (pluginCtx: Context) => {
        pluginCtx.fabric.register({
          kind: 'page',
          id: 'active',
          label: 'Active',
          component: EmptyPage,
        })
        pluginCtx.fabric.register({
          kind: 'toolbar',
          id: 'active-toolbar',
          component: EmptyToolbar,
        })
        pluginCtx.fabric.register({
          kind: 'overlay',
          id: 'active-overlay',
          component: EmptyOverlay,
        })
        pluginCtx.fabric.register({
          kind: 'settings',
          id: 'active-settings',
          component: EmptySettings,
        })
      },
    })

    await downstream.await()
    for (const key of ['fabric.page', 'fabric.toolbar.action', 'fabric.overlay', 'fabric.settings']) {
      expect(slots.entries(key), key).toHaveLength(1)
    }

    await downstream.dispose()
    for (const key of ['fabric.page', 'fabric.toolbar.action', 'fabric.overlay', 'fabric.settings']) {
      expect(slots.entries(key), key).toHaveLength(0)
    }
    await ctx.fiber.dispose()
  })

  it('manages theme contribution lifecycle through the downstream plugin fiber', async () => {
    const { ctx } = await bootFabric(true)
    const downstream = ctx.plugin({
      name: 'fabric-theme-test-plugin',
      inject: ['fabric'],
      apply: (pluginCtx: Context) => {
        pluginCtx.fabric.register({
          kind: 'theme',
          id: 'test-theme',
          tokens: { '--dsw-alias-bg-base': '#abcdef' },
        })
      },
    })

    await downstream.await()
    expect(ctx.fabric.theme.getTokens('global')['--dsw-alias-bg-base']).toBe('#abcdef')

    await downstream.dispose()
    expect(ctx.fabric.theme.getTokens('global')['--dsw-alias-bg-base']).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('cancels a pending registration when the downstream plugin unloads', async () => {
    const { ctx, slots, declare } = await bootFabric(false)
    const downstream = ctx.plugin({
      name: 'fabric-downstream-waiting',
      inject: ['fabric'],
      apply: (pluginCtx: Context) => {
        pluginCtx.fabric.register({
          kind: 'page',
          id: 'waiting',
          label: 'Waiting',
          component: EmptyPage,
        })
      },
    })

    await downstream.await()
    await downstream.dispose()
    declare()
    await Promise.resolve()

    expect(slots.entries('fabric.page')).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('releases config and mod catalog entries with the downstream fiber', async () => {
    const { ctx } = await bootFabric(true)
    const downstream = ctx.plugin({
      name: 'fabric-config-mod',
      inject: ['fabric'],
      apply: (pluginCtx: Context) => {
        pluginCtx.fabric.register({
          kind: 'mod',
          id: 'demo-mod',
          name: 'Demo',
          version: '1.0.0',
        })
        pluginCtx.fabric.registerConfig({
          id: 'demo-config',
          title: 'Demo',
          pluginId: 'demo-mod',
          schema: { enabled: { type: 'boolean', title: 'Enabled', default: false } },
        })
      },
    })

    await downstream.await()
    expect(ctx.fabric.configs.getSnapshot().mods.map(mod => mod.id)).toEqual(['demo-mod'])
    expect(ctx.fabric.configs.getStore('demo-config')?.getSnapshot().values.enabled).toBe(false)

    await downstream.dispose()
    expect(ctx.fabric.configs.getSnapshot().mods).toEqual([])
    expect(ctx.fabric.configs.getStore('demo-config')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
