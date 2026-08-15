import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { fabricConfigResource } from '../resource/config.ts'
import { FabricResourceClientService } from './resources.ts'
import { FabricCapabilityRegistry } from './capabilities.ts'
import { FabricCommandRegistry } from './commands.ts'
import { FabricConfigRegistry } from './config-registry.ts'
import { FabricController } from './controller.ts'
import type { FabricPageCatalog } from './controller.ts'
import type { FabricPageEntry, FabricService } from './contract.ts'
import { FabricRuntimeService } from './service.ts'
import { FabricThemeManager } from './theme.ts'
import { Launcher } from './components/Launcher.tsx'
import { ModMenu } from './components/ModMenu.tsx'
import { FabricSettings } from './components/Settings.tsx'
import { Workbench } from './components/Workbench.tsx'
import type {
  FabricSettingsInjected, WorkbenchInjected,
} from './components/props.ts'
import { en, zh } from './locales.ts'
import type { FabricThemeDefinition } from './theme-contract.ts'

export { defineClientPlugin, mountClientPlugin } from './plugin.ts'
export type { JsonRecord, FabricConfigSchema, ConfigResourceTransport } from '../sdk/config.ts'
export type { JsonValue } from '../sdk/json.ts'

export type {
  FabricCapabilityDefinition, FabricCapabilityHandle, FabricClientPluginContext,
  FabricClientPluginDefinition, FabricCommandDefinition, FabricConfigDefinition,
  FabricConfigHandle, FabricLifecycle, FabricOverlayDefinition, FabricPageActionDefinition, FabricPageActionProps,
  FabricPageContext, FabricPageDefinition, FabricPageHandle, FabricPageProps,
  FabricPluginDescriptor, FabricPluginIdentity, FabricSettingsProps, FabricOverlayProps,
} from './plugin.ts'
export { FabricResourceClientService } from './resources.ts'
export { defineCodec, defineResource, FabricResourceError, jsonCodec, voidCodec } from '../resource/contract.ts'
export type {
  FabricCodec, FabricResourceClient, FabricResourceContext, FabricResourceDefinition,
  FabricResourceEmitter, FabricResourceHandler, FabricResourceHandlers, FabricResourceScope,
  FabricResourceStreamHandler, FabricSessionRef,
} from '../resource/contract.ts'
export type {
  FabricSemanticAccent, FabricSemanticBorder, FabricSemanticContent, FabricSemanticInteraction,
  FabricSemanticMaterial, FabricSemanticState, FabricSemanticStates, FabricSemanticSurface,
  FabricThemeDefinition, FabricThemeProvider,
} from './theme-contract.ts'
export * from '../ui/index.tsx'

export type { FabricNoticeOptions, FabricNoticeTone } from './contract.ts'

const NS = 'fabric'

/** Required Cordis services; slot declaration order is handled by slots.inject. */
export const inject = ['slots', 'locale']

/** Install the Fabric service and its three additive DSH shell surfaces. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fabric: dictionaries')

  let service: FabricRuntimeService

  const catalog: FabricPageCatalog = {
    read: () => ctx.slots.entries('fabric.page').map((entry): FabricPageEntry => {
      const opts = entry.options as {
        id?: string
        order?: number
        label?: unknown
      }
      const id = opts.id ?? ''
      const meta = service?.getPageMetadata(id)
      return {
        id,
        order: opts.order ?? meta?.order ?? 0,
        label: resolveSlotLabel(opts.label as Parameters<typeof resolveSlotLabel>[0]) ?? (typeof meta?.label === 'function' ? meta.label() : meta?.label) ?? id,
        ...(meta?.icon !== undefined ? { icon: meta.icon as React.ReactNode } : {}),
        ...(meta?.badge !== undefined ? { badge: meta.badge } : {}),
        keepAlive: meta?.keepAlive !== false,
        ...(meta?.pluginId !== undefined ? { pluginId: meta.pluginId } : {}),
      }
    }),
    subscribe: (listener) => {
      const stopSlots = ctx.slots.subscribe('fabric.page', listener)
      const stopLocale = ctx.locale.subscribe(listener)
      return () => {
        stopSlots()
        stopLocale()
      }
    },
  }
  const controller = new FabricController(catalog)
  const theme = new FabricThemeManager()
  const defaultTheme: FabricThemeDefinition = {
    surface: {
      base: '#ffffff',
      raised: '#ffffff',
      sunken: '#f3f4f6',
      muted: '#eef0f3',
      overlay: '#ffffff',
    },
    content: {
      primary: '#111827',
      secondary: '#4b5563',
      tertiary: '#6b7280',
      disabled: '#9ca3af',
      inverse: '#ffffff',
    },
    border: {
      subtle: 'rgba(0, 0, 0, 0.08)',
      default: 'rgba(0, 0, 0, 0.14)',
      strong: 'rgba(0, 0, 0, 0.24)',
      focus: '#2563eb',
    },
    accent: {
      primary: '#2563eb',
      hover: '#1d4ed8',
      active: '#1e40af',
      surface: 'rgba(37, 99, 235, 0.14)',
    },
    state: {
      info: { foreground: '#1d4ed8', surface: 'rgba(37, 99, 235, 0.14)', border: 'rgba(37, 99, 235, 0.32)' },
      success: { foreground: '#166534', surface: 'rgba(22, 101, 52, 0.14)', border: 'rgba(22, 101, 52, 0.32)' },
      warning: { foreground: '#92400e', surface: 'rgba(146, 64, 14, 0.14)', border: 'rgba(146, 64, 14, 0.32)' },
      danger: { foreground: '#991b1b', surface: 'rgba(153, 27, 27, 0.14)', border: 'rgba(153, 27, 27, 0.32)' },
    },
    interaction: {
      hover: 'rgba(0, 0, 0, 0.06)',
      active: 'rgba(37, 99, 235, 0.16)',
      selected: 'rgba(37, 99, 235, 0.12)',
      focus: '#2563eb',
    },
    material: {
      acrylicBackground: 'rgba(255, 255, 255, 0.86)',
      acrylicFilter: 'blur(18px)',
      edgeHighlight: 'rgba(255, 255, 255, 0.72)',
      shadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
    },
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontMono: 'ui-monospace, SFMono-Regular, monospace',
  }
  const stopDefaultTheme = theme.setSemantic('fabric:defaults', defaultTheme, { priority: -100 })
  const resourceClient = new FabricResourceClientService('fabric')
  const configs = new FabricConfigRegistry({
    read: async (id, schema) => resourceClient.read(fabricConfigResource, { operation: 'read', id, schema }),
    write: async (id, seq, values, schema) => resourceClient.mutate(fabricConfigResource, { operation: 'write', id, seq, values, schema }),
  })
  const commands = new FabricCommandRegistry(error => { controller.notify(error.message, { tone: 'error' }) })
  const capabilities = new FabricCapabilityRegistry()
  service = new FabricRuntimeService(ctx, controller, theme, configs, commands, capabilities)

  ctx.effect(() => {
    const stop = controller.start()
    const stopCommands = commands.start()
    const stopPages = catalog.subscribe(() => { configs.syncPages(catalog.read()) })
    configs.syncPages(catalog.read())
    return () => {
      stop()
      stopCommands()
      stopPages()
      controller.dispose()
      stopDefaultTheme()
      theme.dispose()
      configs.dispose()
      commands.dispose()
      capabilities.dispose()
    }
  }, 'fabric: controller lifecycle')

  const t = ctx.locale.bind(NS)
  service.register({
    kind: 'page',
    id: 'fabric:mods',
    order: -1000,
    label: () => t('mods.title'),
    icon: '▦',
    keepAlive: true,
    component: ModMenu,
  })
  service.register({
    kind: 'command',
    id: 'fabric.palette',
    order: -300,
    title: () => t('command.palette'),
    shortcut: 'Mod+K',
    handler: () => { commands.togglePalette() },
  })
  service.register({
    kind: 'command',
    id: 'fabric.open',
    order: -200,
    title: () => t('command.open'),
    shortcut: 'Mod+Shift+F',
    handler: () => { controller.open() },
  })
  service.register({
    kind: 'command',
    id: 'fabric.mods',
    order: -190,
    title: () => t('command.mods'),
    handler: () => { controller.open('fabric:mods') },
  })
  service.register({
    kind: 'command',
    id: 'fabric.close',
    order: -180,
    title: () => t('command.close'),
    handler: () => { controller.close() },
  })

  const actions = {
    closeFabric: () => { controller.close() },
    openFabric: (pageId?: string) => { controller.open(pageId) },
    notify: (message: string, options?: Parameters<FabricService['notify']>[1]) => controller.notify(message, options),
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'fabric',
    order: 70,
    locale: NS,
    inject: () => ({ openFabric: () => { controller.open() } }),
  }, Launcher))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'fabric',
    order: 70,
    locale: NS,
    children: {
      'fabric.page': { kind: 'list', scope: 'session-maybe' },
      'fabric.toolbar.action': { kind: 'list', scope: 'session-maybe' },
      'fabric.overlay': { kind: 'list', scope: 'session-maybe' },
    },
    inject: (): WorkbenchInjected => ({
      hooks: { fabric: service },
      ...actions,
      dismissNotice: id => { controller.dismissNotice(id) },
      commands,
    }),
  }, Workbench))

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'fabric',
    order: 70,
    label: () => t('name'),
    locale: NS,
    children: {
      'fabric.settings': { kind: 'list', scope: 'root' },
    },
    inject: (): FabricSettingsInjected => ({
      openFabric: actions.openFabric,
      notify: actions.notify,
      catalog: configs,
    }),
  }, FabricSettings))
}
