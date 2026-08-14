import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { FabricController } from './controller.ts'
import type { FabricPageCatalog } from './controller.ts'
import type { FabricPageEntry, FabricService } from './contract.ts'
import { FabricRuntimeService } from './service.ts'
import { FabricThemeManager } from './theme.ts'
import { Launcher } from './components/Launcher.tsx'
import { FabricSettings } from './components/Settings.tsx'
import { Workbench } from './components/Workbench.tsx'
import type {
  FabricSettingsInjected, WorkbenchInjected,
} from './components/props.ts'
import { en, zh } from './locales.ts'

export type {
  FabricContribution, FabricNotice, FabricNoticeOptions, FabricNoticeTone,
  FabricOverlayContribution, FabricOverlayOwnerProps, FabricOverlayProps,
  FabricPageContribution, FabricPageEntry, FabricPageOwnerProps, FabricPageProps,
  FabricService, FabricSettingsContribution, FabricSettingsOwnerProps, FabricSettingsProps,
  FabricSnapshot, FabricThemeContribution, FabricThemeService, FabricThemeSetOptions,
  FabricToolbarActionOwnerProps, FabricToolbarActionProps, FabricToolbarContribution,
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
      }
      return {
        id: opts.id ?? '',
        order: opts.order ?? 0,
        label: resolveSlotLabel(opts.label as Parameters<typeof resolveSlotLabel>[0]) ?? opts.id ?? '',
        ...(opts.icon !== undefined ? { icon: opts.icon as React.ReactNode } : {}),
        ...(opts.badge !== undefined ? { badge: opts.badge } : {}),
        keepAlive: opts.keepAlive !== false,
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
  const service = new FabricRuntimeService(ctx, controller, theme)

  ctx.effect(() => {
    const stop = controller.start()
    return () => {
      stop()
      controller.dispose()
      theme.dispose()
    }
  }, 'fabric: controller lifecycle')

  const t = ctx.locale.bind(NS)
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
    }),
  }, FabricSettings))
}
