import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, PropsRuntime, SlotComponent, SlotLabel,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Tone used by the framework notice stack. */
export type FabricNoticeTone = 'info' | 'success' | 'warning' | 'error'

export interface FabricNoticeOptions {
  tone?: FabricNoticeTone
  /** Auto-dismiss delay. Zero keeps the notice until explicitly dismissed. */
  timeoutMs?: number
}

export interface FabricNotice {
  readonly id: string
  readonly message: string
  readonly tone: FabricNoticeTone
}

export interface FabricPageEntry {
  readonly id: string
  readonly label: string
  readonly order: number
}

export interface FabricSnapshot {
  readonly open: boolean
  readonly activePage: string | undefined
  readonly pages: readonly FabricPageEntry[]
  readonly notices: readonly FabricNotice[]
  readonly revision: number
}

export interface FabricPageOwnerProps {
  closeFabric: () => void
  openFabric: (pageId?: string) => void
  notify: (message: string, options?: FabricNoticeOptions) => () => void
}

export interface FabricToolbarActionOwnerProps extends FabricPageOwnerProps {
  activePage: string | undefined
}

export interface FabricOverlayOwnerProps extends FabricPageOwnerProps {
  fabricOpen: boolean
  activePage: string | undefined
}

export interface FabricSettingsOwnerProps {
  openFabric: (pageId?: string) => void
  notify: (message: string, options?: FabricNoticeOptions) => () => void
}

/** Complete props delivered to each public contribution kind. */
export type FabricPageProps = PropsRuntime<'fabric.page'>
export type FabricToolbarActionProps = PropsRuntime<'fabric.toolbar.action'>
export type FabricOverlayProps = PropsRuntime<'fabric.overlay'>
export type FabricSettingsProps = PropsRuntime<'fabric.settings'>

interface FabricContributionBase {
  /** Stable identity within this contribution kind. */
  id: string
  /** Ascending visual order. Defaults to zero. */
  order?: number
}

export interface FabricPageContribution extends FabricContributionBase {
  kind: 'page'
  /** Navigation label. A thunk may resolve the current locale lazily. */
  label: SlotLabel
  component: SlotComponent<FabricPageProps>
}

export interface FabricToolbarContribution extends FabricContributionBase {
  kind: 'toolbar'
  component: SlotComponent<FabricToolbarActionProps>
}

export interface FabricOverlayContribution extends FabricContributionBase {
  kind: 'overlay'
  component: SlotComponent<FabricOverlayProps>
}

export interface FabricSettingsContribution extends FabricContributionBase {
  kind: 'settings'
  component: SlotComponent<FabricSettingsProps>
}

export type FabricContribution =
  | FabricPageContribution
  | FabricToolbarContribution
  | FabricOverlayContribution
  | FabricSettingsContribution

/** Browser service exposed as `ctx.fabric`. */
export interface FabricService extends HostObservable<FabricSnapshot> {
  /** Register one contribution for the calling plugin fiber's lifetime. */
  register(contribution: FabricContribution): () => void
  open(pageId?: string): void
  close(): void
  toggle(pageId?: string): void
  navigate(pageId: string): void
  notify(message: string, options?: FabricNoticeOptions): () => void
  dismissNotice(id: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fabric: FabricService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'fabric.page': { kind: 'list'; scope: 'session-maybe'; owner: FabricPageOwnerProps }
    'fabric.toolbar.action': { kind: 'list'; scope: 'session-maybe'; owner: FabricToolbarActionOwnerProps }
    'fabric.overlay': { kind: 'list'; scope: 'session-maybe'; owner: FabricOverlayOwnerProps }
    'fabric.settings': { kind: 'list'; scope: 'root'; owner: FabricSettingsOwnerProps }
  }
}

/** Cordis services required by the browser entry. */
export declare const inject: readonly ['slots', 'locale']

/** Install the Fabric service and its additive DSH shell surfaces. */
export declare function apply(ctx: ClientContext): void
