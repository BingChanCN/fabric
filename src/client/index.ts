import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createJsonClient } from '../sdk/http.ts'
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

export type {
  FabricConfigContribution, FabricContribution, FabricModContribution,
  FabricNotice, FabricNoticeOptions, FabricNoticeTone, FabricOverlayContribution,
  FabricOverlayOwnerProps, FabricOverlayProps, FabricPageContribution,
  FabricPageEntry, FabricPageOwnerProps, FabricPageProps, FabricService,
  FabricSettingsContribution, FabricSettingsOwnerProps, FabricSettingsProps,
  FabricSnapshot, FabricThemeContribution, FabricThemeService, FabricThemeSetOptions,
  FabricToolbarActionOwnerProps, FabricToolbarActionProps, FabricToolbarContribution,
  FabricCommandContribution, FabricCapabilityService, FabricCommandService,
} from './contract.ts'

const NS = 'fabric'

/** Required Cordis services; slot declaration order is handled by slots.inject. */
export const inject = ['slots', 'locale']

/** Install the Fabric service and its three additive DSH shell surfaces. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fabric: dictionaries')

  const catalog: FabricPageCatalog = {
    read: () => ctx.slots.entries('fabric.page').map((entry): FabricPageEntry => {
      const opts = entry.options as {
        id?: string
        order?: number
        label?: unknown
        icon?: unknown
        badge?: string | number
        keepAlive?: boolean
        pluginId?: string
      }
      return {
        id: opts.id ?? '',
        order: opts.order ?? 0,
        label: resolveSlotLabel(opts.label as Parameters<typeof resolveSlotLabel>[0]) ?? opts.id ?? '',
        ...(opts.icon !== undefined ? { icon: opts.icon as React.ReactNode } : {}),
        ...(opts.badge !== undefined ? { badge: opts.badge } : {}),
        keepAlive: opts.keepAlive !== false,
        ...(opts.pluginId !== undefined ? { pluginId: opts.pluginId } : {}),
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
  const configs = new FabricConfigRegistry(createJsonClient({ sessionId: () => undefined }))
  const commands = new FabricCommandRegistry(error => { controller.notify(error.message, { tone: 'error' }) })
  const capabilities = new FabricCapabilityRegistry()
  const service = new FabricRuntimeService(ctx, controller, theme, configs, commands, capabilities)

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
