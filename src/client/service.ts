import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  FabricCommandContribution, FabricConfigContribution, FabricContribution,
  FabricModContribution, FabricOverlayContribution, FabricPageContribution,
  FabricService, FabricSettingsContribution, FabricThemeContribution,
  FabricThemeService, FabricToolbarContribution,
} from './contract.ts'
import type { FabricCapabilityRegistry } from './capabilities.ts'
import type { FabricCommandRegistry } from './commands.ts'
import type { FabricConfigRegistry } from './config-registry.ts'
import type { FabricController } from './controller.ts'
import type { FabricThemeManager } from './theme.ts'

/**
 * Cordis service facade for downstream plugins.
 *
 * Service methods are invoked through Cordis' traceable proxy. The proxy
 * shadows `ctx` with the caller's context, so slot effects belong to the
 * downstream plugin fiber rather than Fabric's own fiber.
 */
export class FabricRuntimeService extends Service implements FabricService {
  private readonly pageMetadata = new Map<string, Omit<FabricPageContribution, 'component'>>()

  constructor(
    ctx: Context,
    private readonly controller: FabricController,
    readonly theme: FabricThemeManager,
    readonly configs: FabricConfigRegistry,
    readonly commands: FabricCommandRegistry,
    readonly capabilities: FabricCapabilityRegistry,
  ) {
    super(ctx, 'fabric')
  }

  getPageMetadata(id: string): Omit<FabricPageContribution, 'component'> | undefined {
    return this.pageMetadata.get(id)
  }

  getSnapshot(): ReturnType<FabricService['getSnapshot']> {
    return this.controller.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.controller.subscribe(listener)
  }

  register(contribution: FabricContribution): () => void {
    switch (contribution.kind) {
      case 'theme':
        return this.registerTheme(contribution)
      case 'mod':
        return this.registerMod(contribution)
      case 'config':
        return this.registerConfigContribution(contribution)
      case 'command':
        return this.registerCommand(contribution)
      default:
        break
    }

    const slots = this.ctx.get('slots') as SlotRegistry | undefined
    if (slots === undefined) throw new Error('fabric: slots service unavailable')
    switch (contribution.kind) {
      case 'page':
        return this.registerPage(slots, contribution)
      case 'toolbar':
        return this.registerToolbar(slots, contribution)
      case 'overlay':
        return this.registerOverlay(slots, contribution)
      case 'settings':
        return this.registerSettings(slots, contribution)
    }
  }

  registerConfig(definition: Omit<FabricConfigContribution, 'kind'>): () => void {
    return this.registerConfigContribution({ kind: 'config', ...definition })
  }

  registerCapability<T>(id: string, version: string, scope: 'profile' | 'session', impl: T): () => void {
    const unregister = this.capabilities.register(id, version, scope, impl)
    this.ctx.effect(() => () => { unregister() }, `fabric: capability ${id}`)
    return unregister
  }

  getCapability<T>(id: string, version?: string, scope: 'profile' | 'session' = 'profile'): T | undefined {
    return this.capabilities.get<T>(id, version, scope)
  }

  open(pageId?: string): void {
    this.controller.open(pageId)
  }

  close(): void {
    this.controller.close()
  }

  toggle(pageId?: string): void {
    this.controller.toggle(pageId)
  }

  navigate(pageId: string): void {
    this.controller.navigate(pageId)
  }

  notify(message: string, options?: Parameters<FabricService['notify']>[1]): () => void {
    return this.controller.notify(message, options)
  }

  dismissNotice(id: string): void {
    this.controller.dismissNotice(id)
  }

  private registerTheme(contribution: FabricThemeContribution): () => void {
    const unregisterTheme = this.theme.setTokens(
      contribution.id,
      contribution.tokens,
      {
        ...(contribution.priority !== undefined ? { priority: contribution.priority } : {}),
        ...(contribution.scope !== undefined ? { scope: contribution.scope } : {}),
      },
    )
    const unregisterCatalog = this.configs.registerTheme({
      id: contribution.id,
      ...(contribution.pluginId !== undefined ? { pluginId: contribution.pluginId } : {}),
      ...(contribution.scope !== undefined ? { scope: contribution.scope } : {}),
      ...(contribution.priority !== undefined ? { priority: contribution.priority } : {}),
    })
    const unregister = (): void => {
      unregisterTheme()
      unregisterCatalog()
    }
    this.ctx.effect(() => () => { unregister() }, `fabric: theme ${contribution.id}`)
    return unregister
  }

  private registerMod(contribution: FabricModContribution): () => void {
    const unregister = this.configs.registerMod({
      id: contribution.id,
      name: contribution.name,
      ...(contribution.order !== undefined ? { order: contribution.order } : {}),
      ...(contribution.version !== undefined ? { version: contribution.version } : {}),
      ...(contribution.description !== undefined ? { description: contribution.description } : {}),
      ...(contribution.icon !== undefined ? { icon: contribution.icon } : {}),
    })
    this.ctx.effect(() => () => { unregister() }, `fabric: mod ${contribution.id}`)
    return unregister
  }

  private registerCommand(contribution: FabricCommandContribution): () => void {
    const unregister = this.commands.register({
      id: contribution.id,
      title: contribution.title,
      handler: contribution.handler,
      ...(contribution.order !== undefined ? { order: contribution.order } : {}),
      ...(contribution.description !== undefined ? { description: contribution.description } : {}),
      ...(contribution.shortcut !== undefined ? { shortcut: contribution.shortcut } : {}),
      ...(contribution.pluginId !== undefined ? { pluginId: contribution.pluginId } : {}),
    })
    this.ctx.effect(() => () => { unregister() }, `fabric: command ${contribution.id}`)
    return unregister
  }

  private registerConfigContribution(contribution: FabricConfigContribution): () => void {
    const unregister = this.configs.registerConfig({
      id: contribution.id,
      title: contribution.title,
      schema: contribution.schema,
      ...(contribution.order !== undefined ? { order: contribution.order } : {}),
      ...(contribution.description !== undefined ? { description: contribution.description } : {}),
      ...(contribution.pluginId !== undefined ? { pluginId: contribution.pluginId } : {}),
    })
    this.ctx.effect(() => () => { unregister() }, `fabric: config ${contribution.id}`)
    return unregister
  }

  private registerPage(slots: SlotRegistry, contribution: FabricPageContribution): () => void {
    this.pageMetadata.set(contribution.id, {
      kind: 'page',
      id: contribution.id,
      label: contribution.label,
      ...(contribution.order !== undefined ? { order: contribution.order } : {}),
      ...(contribution.icon !== undefined ? { icon: contribution.icon } : {}),
      ...(contribution.badge !== undefined ? { badge: contribution.badge } : {}),
      ...(contribution.keepAlive !== undefined ? { keepAlive: contribution.keepAlive } : {}),
      ...(contribution.pluginId !== undefined ? { pluginId: contribution.pluginId } : {}),
    })

    const unregisterSlot = slots.inject('fabric.page', () => slots.register({
      name: 'fabric.page',
      id: contribution.id,
      ...(contribution.order === undefined ? {} : { order: contribution.order }),
      label: contribution.label,
    }, contribution.component))

    const unregister = (): void => {
      unregisterSlot()
      this.pageMetadata.delete(contribution.id)
    }
    this.ctx.effect(() => () => { unregister() }, `fabric: page ${contribution.id}`)
    return unregister
  }

  private registerToolbar(slots: SlotRegistry, contribution: FabricToolbarContribution): () => void {
    return slots.inject('fabric.toolbar.action', () => slots.register({
      name: 'fabric.toolbar.action',
      id: contribution.id,
      ...(contribution.order === undefined ? {} : { order: contribution.order }),
    }, contribution.component))
  }

  private registerOverlay(slots: SlotRegistry, contribution: FabricOverlayContribution): () => void {
    return slots.inject('fabric.overlay', () => slots.register({
      name: 'fabric.overlay',
      id: contribution.id,
      ...(contribution.order === undefined ? {} : { order: contribution.order }),
    }, contribution.component))
  }

  private registerSettings(slots: SlotRegistry, contribution: FabricSettingsContribution): () => void {
    return slots.inject('fabric.settings', () => slots.register({
      name: 'fabric.settings',
      id: contribution.id,
      ...(contribution.order === undefined ? {} : { order: contribution.order }),
    }, contribution.component))
  }
}
