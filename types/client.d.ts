import type { ComponentType, ReactNode } from 'react'
import type {
  ConfigSnapshot, ConfigStore, FabricConfigSchema, JsonRecord, JsonValue,
} from './sdk.d.ts'
import type { EventStream } from './sdk.d.ts'

export type { FabricConfigSchema, JsonRecord, JsonValue }

export type FabricResourceScope = 'profile' | 'session'
export interface FabricSessionRef { readonly id: string }
export interface FabricCodec<T> { parse(value: unknown): T }
export interface FabricResourceDefinition<Request, Response, Event = never> {
  readonly id: string
  readonly version: string
  readonly scope: FabricResourceScope
  readonly request: FabricCodec<Request>
  readonly response: FabricCodec<Response>
  readonly event?: FabricCodec<Event>
}
export interface FabricResourceContext {
  readonly pluginId: string
  readonly resourceId: string
  readonly scope: FabricResourceScope
  readonly session: FabricSessionRef | undefined
  readonly signal: AbortSignal
}
export type FabricResourceHandler<Request, Response> = (request: Request, context: FabricResourceContext) => Response | Promise<Response>
export type FabricResourceEmitter<Event> = (event: Event) => void
export type FabricResourceStreamHandler<Request, Event> = (request: Request, context: FabricResourceContext, emit: FabricResourceEmitter<Event>) => void | (() => void) | Promise<void | (() => void)>
export interface FabricResourceHandlers<Request, Response, Event = never> {
  readonly query?: FabricResourceHandler<Request, Response>
  readonly mutate?: FabricResourceHandler<Request, Response>
  readonly stream?: FabricResourceStreamHandler<Request, Event>
}
export interface FabricResourceRequestOptions { readonly signal?: AbortSignal; readonly session?: FabricSessionRef }
export interface FabricResourceWatchOptions extends FabricResourceRequestOptions { readonly minRetryMs?: number; readonly maxRetryMs?: number }
export interface FabricResourceClient {
  read<Request, Response>(resource: FabricResourceDefinition<Request, Response, never>, request: Request, options?: FabricResourceRequestOptions): Promise<Response>
  mutate<Request, Response>(resource: FabricResourceDefinition<Request, Response, never>, request: Request, options?: FabricResourceRequestOptions): Promise<Response>
  watch<Request, Event>(resource: FabricResourceDefinition<Request, unknown, Event> & { readonly event: FabricCodec<Event> }, request: Request, options?: FabricResourceWatchOptions): EventStream<Event>
}
export class FabricResourceError extends Error {
  readonly code: string
  readonly details: unknown
  readonly retryable: boolean
}
export declare function defineCodec<T>(parse: (value: unknown) => T): FabricCodec<T>
export declare function defineResource<Request, Response, Event = never>(definition: FabricResourceDefinition<Request, Response, Event>): FabricResourceDefinition<Request, Response, Event>
export declare const jsonCodec: FabricCodec<unknown>
export declare const voidCodec: FabricCodec<void>
export declare const FabricResourceClientService: new (pluginId: string) => FabricResourceClient

export interface FabricSemanticSurface { readonly base: string; readonly raised: string; readonly sunken: string; readonly muted: string; readonly overlay: string }
export interface FabricSemanticContent { readonly primary: string; readonly secondary: string; readonly tertiary: string; readonly disabled: string; readonly inverse: string }
export interface FabricSemanticBorder { readonly subtle: string; readonly default: string; readonly strong: string; readonly focus: string }
export interface FabricSemanticAccent { readonly primary: string; readonly hover: string; readonly active: string; readonly surface: string }
export interface FabricSemanticState { readonly foreground: string; readonly surface: string; readonly border: string }
export interface FabricSemanticStates { readonly info: FabricSemanticState; readonly success: FabricSemanticState; readonly warning: FabricSemanticState; readonly danger: FabricSemanticState }
export interface FabricSemanticInteraction { readonly hover: string; readonly active: string; readonly selected: string; readonly focus: string }
export interface FabricSemanticMaterial { readonly acrylicBackground: string; readonly acrylicFilter: string; readonly edgeHighlight: string; readonly shadow: string }
export interface FabricThemeDefinition {
  readonly surface: FabricSemanticSurface
  readonly content: FabricSemanticContent
  readonly border: FabricSemanticBorder
  readonly accent: FabricSemanticAccent
  readonly state: FabricSemanticStates
  readonly interaction: FabricSemanticInteraction
  readonly material: FabricSemanticMaterial
  readonly fontFamily?: string
  readonly fontMono?: string
}
export interface FabricThemeProvider {
  provide(id: string, theme: FabricThemeDefinition, options?: { readonly priority?: number; readonly scope?: 'global' | 'workbench' }): () => void
  clear(id: string): void
  isDark(): boolean
  onChange(listener: (theme: { readonly dark: boolean }) => void): () => void
}

export interface FabricNoticeOptions { readonly tone?: 'info' | 'success' | 'warning' | 'error'; readonly timeoutMs?: number }
export type FabricNoticeTone = NonNullable<FabricNoticeOptions['tone']>
export interface FabricPluginDescriptor { readonly name: string; readonly description?: string; readonly icon?: ReactNode }
export interface FabricPluginIdentity extends FabricPluginDescriptor { readonly id: string; readonly packageName: string; readonly version: string }
export interface FabricLifecycle { readonly signal: AbortSignal; onDispose(cleanup: () => void): void }
export interface FabricPageContext {
  readonly id: string
  readonly pluginId: string
  readonly session: FabricSessionRef | undefined
  readonly signal: AbortSignal
  readonly resources: FabricResourceClient
  config<T extends JsonRecord = JsonRecord>(id: string): FabricConfigHandle<T>
  open(pageId?: string): void
  close(): void
  notify(message: string, options?: FabricNoticeOptions): () => void
}
export interface FabricPageProps {
  readonly page: FabricPageContext
  readonly session: FabricSessionRef | undefined
  readonly sessionId: string | undefined
  readonly resources: FabricResourceClient
  readonly config: <T extends JsonRecord = JsonRecord>(id: string) => FabricConfigHandle<T>
  readonly openFabric: (pageId?: string) => void
  readonly notify: (message: string, options?: FabricNoticeOptions) => () => void
}
export interface FabricPageActionProps {
  readonly pageId: string | undefined
  readonly activePage: string | undefined
  readonly open: (pageId?: string) => void
  readonly close: () => void
  readonly notify: (message: string, options?: FabricNoticeOptions) => () => void
}
export interface FabricOverlayProps {
  readonly pageId: string | undefined
  readonly open: boolean
  readonly activePage: string | undefined
  readonly openFabric: (pageId?: string) => void
  readonly close: () => void
  readonly notify: (message: string, options?: FabricNoticeOptions) => () => void
  readonly config: <T extends JsonRecord = JsonRecord>(id: string) => FabricConfigHandle<T>
}
export interface FabricOverlayDefinition { readonly id: string; readonly order?: number; readonly component: ComponentType<FabricOverlayProps>; readonly config?: readonly FabricConfigHandle[] }
export interface FabricSettingsProps { readonly open: (pageId?: string) => void; readonly config: FabricConfigHandle; readonly resources: FabricResourceClient; readonly notify: (message: string, options?: FabricNoticeOptions) => () => void }
export interface FabricPageActionDefinition { readonly id: string; readonly order?: number; readonly component: ComponentType<FabricPageActionProps> }
export interface FabricPageDefinition { readonly id: string; readonly label: string; readonly order?: number; readonly icon?: ReactNode; readonly badge?: string | number; readonly keepAlive?: boolean; readonly scope?: 'profile' | 'session'; readonly view: ComponentType<FabricPageProps>; readonly actions?: readonly FabricPageActionDefinition[]; readonly config?: readonly FabricConfigHandle[] }
export interface FabricPageHandle { readonly id: string; open(): void }
export interface FabricCommandDefinition { readonly id: string; readonly title: string; readonly description?: string; readonly shortcut?: string; readonly order?: number; readonly run: (signal?: AbortSignal) => void | Promise<void> }
export interface FabricConfigDefinition<T extends JsonRecord = JsonRecord> { readonly id: string; readonly title: string; readonly description?: string; readonly schema: FabricConfigSchema; readonly settings?: ComponentType<FabricSettingsProps>; readonly valueType?: T }
export interface FabricConfigHandle<T extends JsonRecord = JsonRecord> {
  readonly id: string
  getSnapshot(): ConfigSnapshot<T>
  subscribe(listener: () => void): () => void
  set(patch: Partial<T>): void
  reset(): void
  load(): Promise<ConfigSnapshot<T>>
  persist(): Promise<ConfigSnapshot<T>>
}
export interface FabricCapabilityDefinition<T> { readonly id: string; readonly version: string; readonly scope?: 'profile' | 'session'; readonly implementation: T }
export interface FabricCapabilityHandle<T> { readonly id: string; readonly version: string; get(): T | undefined }
export interface FabricClientPluginContext {
  readonly identity: FabricPluginIdentity
  readonly lifecycle: FabricLifecycle
  readonly pages: { define(definition: FabricPageDefinition): FabricPageHandle; open(pageId?: string): void; close(): void }
  readonly commands: { define(definition: FabricCommandDefinition): () => void }
  readonly config: { define<T extends JsonRecord>(definition: FabricConfigDefinition<T>): FabricConfigHandle<T> }
  readonly overlays: { define(definition: FabricOverlayDefinition): () => void }
  readonly capabilities: { provide<T>(definition: FabricCapabilityDefinition<T>): FabricCapabilityHandle<T>; require<T>(id: string, version?: string, scope?: 'profile' | 'session'): T; optional<T>(id: string, version?: string, scope?: 'profile' | 'session'): T | undefined }
  readonly theme: FabricThemeProvider
  readonly resources: FabricResourceClient
  readonly notify: (message: string, options?: FabricNoticeOptions) => () => void
  readonly open: (pageId?: string) => void
  readonly close: () => void
}
export interface FabricClientPluginDefinition { readonly descriptor: FabricPluginDescriptor; readonly setup: (context: FabricClientPluginContext) => void | (() => void) }
export declare function defineClientPlugin(definition: FabricClientPluginDefinition): FabricClientPluginDefinition
export declare function mountClientPlugin(packageName: string, version: string, definition: FabricClientPluginDefinition): { readonly inject: readonly ['fabric']; readonly apply: (ctx: unknown) => void }

export * from './ui'
