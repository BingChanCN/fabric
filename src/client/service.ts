import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  FabricContribution, FabricOverlayContribution, FabricPageContribution,
  FabricService, FabricSettingsContribution, FabricThemeContribution,
  FabricThemeService, FabricToolbarContribution,
} from './contract.ts'
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
  constructor(
    ctx: Context,
    private readonly controller: FabricController,
    readonly theme: FabricThemeManager,
  ) {
    super(ctx, 'fabric')
  }

  getSnapshot(): ReturnType<FabricService['getSnapshot']> {
    return this.controller.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.controller.subscribe(listener)
  }

  register(contribution: FabricContribution): () => void {
    if (contribution.kind === 'theme') {
      return this.registerTheme(contribution)
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
    const unregister = this.theme.setTokens(
      contribution.id,
      contribution.tokens,
      {
        ...(contribution.priority !== undefined ? { priority: contribution.priority } : {}),
        ...(contribution.scope !== undefined ? { scope: contribution.scope } : {}),
      },
    )
    this.ctx.effect(() => () => { unregister() }, `fabric: theme ${contribution.id}`)
    return unregister
  }

  private registerPage(slots: SlotRegistry, contribution: FabricPageContribution): () => void {
    return slots.inject('fabric.page', () => slots.register({
      name: 'fabric.page',
      id: contribution.id,
      ...(contribution.order === undefined ? {} : { order: contribution.order }),
      label: contribution.label,
      icon: contribution.icon,
      badge: contribution.badge,
      keepAlive: contribution.keepAlive,
    } as any, contribution.component))
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
