import type { ReactNode } from 'react'
import type { FabricThemeDefinition } from './theme-contract.ts'
import type {
  HostObservable, PropsRuntime, SlotComponent, SlotLabel,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  FabricConfigRecord, FabricConfigRuntime, FabricConfigSchema, FabricModRecord,
  FabricThemeRecord,
} from '../sdk/config.ts'
import type { FabricCapabilityService } from './capabilities.ts'
import type {
  FabricCapabilityBinding, FabricCapabilityDefinition, FabricCapabilityProviderHandle,
} from '../capability/contract.ts'
import type { FabricCommandDefinition, FabricCommandService } from './commands.ts'
import type { FabricDialogRegistry } from './dialogs.tsx'
import type { FabricClientOperationHost } from './operations.ts'

/** Tone used by the framework notice stack. */
export type FabricNoticeTone = 'info' | 'success' | 'warning' | 'error'

/** Options accepted by {@link FabricService.notify}. */
export interface FabricNoticeOptions {
  tone?: FabricNoticeTone
  /** Auto-dismiss delay. Zero keeps the notice until explicitly dismissed. */
  timeoutMs?: number
}

/** One immutable notice in the framework snapshot. */
export interface FabricNotice {
  readonly id: string
  readonly message: string
  readonly tone: FabricNoticeTone
  /** Internal runtime owner used to retract notices during hot unload. */
  readonly owner?: string
}

/** Navigation metadata projected from a `fabric.page` slot contribution. */
export interface FabricPageEntry {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly icon?: ReactNode
  readonly badge?: string | number
  readonly keepAlive?: boolean
  readonly pluginId?: string
}

/** Immutable observable state exposed by `ctx.fabric`. */
export interface FabricSnapshot {
  readonly open: boolean
  readonly activePage: string | undefined
  readonly pages: readonly FabricPageEntry[]
  readonly notices: readonly FabricNotice[]
  readonly revision: number
}

interface FabricOwnerActions {
  closeFabric: () => void
  openFabric: (pageId?: string) => void
  notify: (message: string, options?: FabricNoticeOptions) => () => void
}

/** Common actions and runtime labels supplied to a Fabric page at its render site. */
export interface FabricPageOwnerProps extends FabricOwnerActions {
  fabricPageErrorLabel: string
  fabricPageRetryLabel: string
}

/** Owner data supplied to actions in the workbench toolbar. */
export interface FabricToolbarActionOwnerProps extends FabricOwnerActions {
  activePage: string | undefined
}

/** Owner data supplied to persistent HUD surfaces outside the workbench drawer. */
export interface FabricHudOwnerProps extends FabricOwnerActions {
  fabricOpen: boolean
  activePage: string | undefined
}

/** Owner data supplied to settings contributions. */
export interface FabricSettingsOwnerProps {
  openFabric: (pageId?: string) => void
  notify: (message: string, options?: FabricNoticeOptions) => () => void
}

/** Complete props delivered to each public contribution kind. */
export type FabricPageProps = PropsRuntime<'fabric.page'>
export type FabricToolbarActionProps = PropsRuntime<'fabric.toolbar.action'>
export type FabricHudProps = PropsRuntime<'fabric.hud'>
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
  /** Optional icon displayed in navigation (ReactNode or SVG). */
  icon?: ReactNode
  /** Optional badge or counter indicator. */
  badge?: string | number
  /** Whether to retain component state when navigating away (default: true). */
  keepAlive?: boolean
  /** Optional owning mod id used by ModMenu grouping. */
  pluginId?: string
  component: SlotComponent<FabricPageProps>
}

export interface FabricToolbarContribution extends FabricContributionBase {
  kind: 'toolbar'
  component: SlotComponent<FabricToolbarActionProps>
}

export interface FabricHudContribution extends FabricContributionBase {
  kind: 'hud'
  pluginId?: string
  component: SlotComponent<FabricHudProps>
}

export interface FabricSettingsContribution extends FabricContributionBase {
  kind: 'settings'
  pluginId?: string
  component: SlotComponent<FabricSettingsProps>
}

/** Theme token override contribution. */
export interface FabricThemeContribution extends FabricContributionBase {
  kind: 'theme'
  /** CSS variable map, e.g. `{ '--dsw-alias-bg-base': '#1e1e2e' }`. */
  tokens: Record<string, string>
  /** Higher priority wins when multiple plugins set the same token. Defaults to 0. */
  priority?: number
  /** Scope of the override. Defaults to 'global'. */
  scope?: 'global' | 'workbench'
  /** Optional owning mod id used by ModMenu grouping. */
  pluginId?: string
}

/** Identity card for a downstream plugin, shown in ModMenu. */
export interface FabricModContribution extends FabricContributionBase {
  kind: 'mod'
  name: string
  version?: string
  description?: string
  icon?: ReactNode
}

/** Schema-driven config document owned by Fabric's host store. */
export interface FabricConfigContribution extends FabricContributionBase {
  kind: 'config'
  title: string
  description?: string
  pluginId?: string
  owner?: string
  documentId?: string
  schema: FabricConfigSchema
}

/** Command palette / shortcut contribution. */
export interface FabricCommandContribution extends FabricContributionBase {
  kind: 'command'
  title: FabricCommandDefinition['title']
  handler: (signal: AbortSignal) => void | Promise<void>
  description?: string
  shortcut?: string
  pluginId?: string
}

/** Contributions accepted by {@link FabricService.register}. */
export type FabricContribution =
  | FabricPageContribution
  | FabricToolbarContribution
  | FabricHudContribution
  | FabricSettingsContribution
  | FabricThemeContribution
  | FabricModContribution
  | FabricConfigContribution
  | FabricCommandContribution

export type { FabricCapabilityService, FabricCommandDefinition, FabricCommandService }

export type {
  FabricConfigRecord, FabricConfigRuntime, FabricConfigSchema, FabricModRecord,
  FabricThemeRecord,
}

/** Options for setting theme tokens via {@link FabricThemeService.setTokens}. */
export interface FabricThemeSetOptions {
  priority?: number
  scope?: 'global' | 'workbench'
}

/** Theme management service exposed on `ctx.fabric.theme`. */
export interface FabricThemeService {
  /** Internal DSH bridge for the Fabric runtime. */
  setTokens(id: string, tokens: Record<string, string>, options?: FabricThemeSetOptions): () => void
  /** Apply a Fabric semantic theme through the private DSH bridge. */
  setSemantic(id: string, theme: FabricThemeDefinition, options?: FabricThemeSetOptions): () => void
  /** Clear token overrides registered under an id. */
  clearTokens(id: string): void
  /** Read current active tokens for a given scope. */
  getTokens(scope?: 'global' | 'workbench'): Record<string, string>
  /** Subscribe to theme/dark-mode switches. Returns an unsubscribe disposer. */
  onThemeChange(listener: (theme: { dark: boolean }) => void): () => void
  /** Whether the host is currently in dark theme mode. */
  isDark(): boolean
}

/** Public browser service shared by Fabric-aware DSH plugins. */
export interface FabricService extends HostObservable<FabricSnapshot> {
  /** Register one contribution for the calling plugin fiber's lifetime. */
  register(contribution: FabricContribution): () => void
  open(pageId?: string): void
  close(): void
  toggle(pageId?: string): void
  navigate(pageId: string): void
  notify(message: string, options?: FabricNoticeOptions): () => void
  /** Runtime-package notice scoped to its canonical package owner. */
  notifyOwned(owner: string, message: string, options?: FabricNoticeOptions): () => void
  dismissNotice(id: string): void
  dismissNoticesByOwner(owner: string): void
  /** Update a registered page badge. Normal plugins use the handle returned by pages.define. */
  setPageBadge(id: string, value: string | number | undefined): void
  /** Theme management service. */
  readonly theme: FabricThemeService
  /** Schema-driven config / mod catalog. */
  readonly configs: FabricConfigRuntime
  /** Command palette and global shortcuts. */
  readonly commands: FabricCommandService
  /** Cross-plugin named capabilities. */
  readonly capabilities: FabricCapabilityService
  /** Profile-singleton dialog stack. Normal plugins use context.dialogs. */
  readonly dialogs: FabricDialogRegistry
  /** Typed long-running Host operations. */
  readonly operations: FabricClientOperationHost
  /** Register a persisted config document and auto-render it in settings. */
  registerConfig(definition: Omit<FabricConfigContribution, 'kind'>): () => void
  /** Provide a typed capability owned by the provider's canonical package name. */
  provideCapability<T extends object>(
    providerOwner: string,
    definition: FabricCapabilityDefinition<T>,
    implementation: T,
    generation?: string,
  ): FabricCapabilityProviderHandle<T>
  /** Observe a typed capability even when its provider is not currently active. */
  consumeCapability<T extends object>(definition: FabricCapabilityDefinition<T>): FabricCapabilityBinding<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fabric: FabricService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Primary workbench pages. List metadata (`id`, `order`, `label`) drives navigation. */
    'fabric.page': { kind: 'list'; scope: 'session-maybe'; owner: FabricPageOwnerProps }
    /** Compact commands rendered beside the active page title. */
    'fabric.toolbar.action': { kind: 'list'; scope: 'session-maybe'; owner: FabricToolbarActionOwnerProps }
    /** Persistent non-modal HUD surfaces hosted outside the workbench drawer. */
    'fabric.hud': { kind: 'list'; scope: 'session-maybe'; owner: FabricHudOwnerProps }
    /** Settings sections contributed inside Fabric's Plugins tab. */
    'fabric.settings': { kind: 'list'; scope: 'root'; owner: FabricSettingsOwnerProps }
  }
}
