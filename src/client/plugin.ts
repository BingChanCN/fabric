import { createElement, type ComponentType, type ReactNode } from 'react'
import type {
  FabricConfigSchema, JsonRecord,
} from '../sdk/config.ts'
import type {
  FabricResourceClient, FabricResourceDefinition, FabricResourceHandlers,
  FabricSessionRef,
} from '../resource/contract.ts'
import { FabricResourceClientService } from './resources.ts'
import type { FabricThemeDefinition, FabricThemeProvider } from './theme-contract.ts'
import type { FabricNoticeOptions, FabricNoticeTone, FabricService } from './contract.ts'
import type { FabricPageProps as LegacyPageProps, FabricSettingsProps as LegacySettingsProps, FabricToolbarActionProps as LegacyActionProps } from './contract.ts'
import { runtimePluginId } from '../plugin-identity.ts'

export interface FabricPluginDescriptor {
  readonly name: string
  readonly description?: string
  readonly icon?: ReactNode
}

export interface FabricPluginIdentity extends FabricPluginDescriptor {
  /** Short runtime namespace used by Fabric registries and Resource routes. */
  readonly id: string
  /** Full npm package name used by the ModuleLoader ABI. */
  readonly packageName: string
  readonly version: string
}

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

export interface FabricOverlayDefinition {
  readonly id: string
  readonly order?: number
  readonly component: ComponentType<FabricOverlayProps>
  readonly config?: readonly FabricConfigHandle[]
}

export interface FabricSettingsProps {
  readonly open: (pageId?: string) => void
  readonly config: FabricConfigHandle
  readonly resources: FabricResourceClient
  readonly notify: (message: string, options?: FabricNoticeOptions) => () => void
}

export interface FabricPageActionDefinition {
  readonly id: string
  readonly order?: number
  readonly component: ComponentType<FabricPageActionProps>
}

export interface FabricPageDefinition {
  readonly id: string
  readonly label: string
  readonly order?: number
  readonly icon?: ReactNode
  readonly badge?: string | number
  readonly keepAlive?: boolean
  readonly scope?: 'profile' | 'session'
  readonly view: ComponentType<FabricPageProps>
  readonly actions?: readonly FabricPageActionDefinition[]
  readonly config?: readonly FabricConfigHandle[]
}

export interface FabricPageHandle {
  readonly id: string
  open(): void
}

export interface FabricCommandDefinition {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly shortcut?: string
  readonly order?: number
  readonly run: (signal?: AbortSignal) => void | Promise<void>
}

export interface FabricConfigDefinition<T extends JsonRecord = JsonRecord> {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly schema: FabricConfigSchema
  readonly settings?: ComponentType<FabricSettingsProps>
  readonly valueType?: T
}

export interface FabricConfigHandle<T extends JsonRecord = JsonRecord> {
  readonly id: string
  getSnapshot(): import('../sdk/config.ts').ConfigSnapshot<T>
  subscribe(listener: () => void): () => void
  set(patch: Partial<T>): void
  reset(): void
  load(): Promise<import('../sdk/config.ts').ConfigSnapshot<T>>
  persist(): Promise<import('../sdk/config.ts').ConfigSnapshot<T>>
}

export interface FabricCapabilityDefinition<T> {
  readonly id: string
  readonly version: string
  readonly scope?: 'profile' | 'session'
  readonly implementation: T
}

export interface FabricCapabilityHandle<T> {
  readonly id: string
  readonly version: string
  get(): T | undefined
}

export interface FabricLifecycle {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void): void
}

export interface FabricClientPluginContext {
  readonly identity: FabricPluginIdentity
  readonly lifecycle: FabricLifecycle
  readonly pages: {
    define(definition: FabricPageDefinition): FabricPageHandle
    open(pageId?: string): void
    close(): void
  }
  readonly commands: {
    define(definition: FabricCommandDefinition): () => void
  }
  readonly config: {
    define<T extends JsonRecord>(definition: FabricConfigDefinition<T>): FabricConfigHandle<T>
  }
  readonly overlays: {
    define(definition: FabricOverlayDefinition): () => void
  }
  readonly capabilities: {
    provide<T>(definition: FabricCapabilityDefinition<T>): FabricCapabilityHandle<T>
    require<T>(id: string, version?: string, scope?: 'profile' | 'session'): T
    optional<T>(id: string, version?: string, scope?: 'profile' | 'session'): T | undefined
  }
  readonly theme: FabricThemeProvider
  readonly resources: FabricResourceClient
  readonly notify: (message: string, options?: FabricNoticeOptions) => () => void
  readonly open: (pageId?: string) => void
  readonly close: () => void
}

export interface FabricClientPluginDefinition {
  readonly descriptor: FabricPluginDescriptor
  readonly setup: (context: FabricClientPluginContext) => void | (() => void)
}

export function defineClientPlugin(definition: FabricClientPluginDefinition): FabricClientPluginDefinition {
  if (definition.descriptor.name.trim() === '') throw new Error('fabric plugin name must not be empty')
  return Object.freeze(definition)
}

export { runtimePluginId } from '../plugin-identity.ts'

function scopedId(pluginId: string, localId: string): string {
  const local = localId.trim()
  if (local === '') throw new Error('fabric contribution id must not be empty')
  return `${pluginId}:${local}`
}

function configId(pluginId: string, localId: string): string {
  const local = localId.trim()
  if (local === '') throw new Error('fabric config id must not be empty')
  return `${pluginId.replace(/[^A-Za-z0-9._-]/gu, '.')}.${local}`
}

function localPageId(pluginId: string, pageId: string | undefined): string | undefined {
  if (pageId === undefined) return undefined
  const prefix = `${pluginId}:`
  return pageId.startsWith(prefix) ? pageId.slice(prefix.length) : pageId
}

type DshContext = {
  readonly fabric?: FabricService
  effect(setup: () => void | (() => void), name?: string): unknown
}

function asSession(value: unknown): FabricSessionRef | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return { id: value }
}

function makeClientContext(
  identity: FabricPluginIdentity,
  service: FabricService,
  lifecycle: FabricLifecycle,
): FabricClientPluginContext {
  const resources = new FabricResourceClientService(identity.id, lifecycle)

  const notify = (message: string, options?: FabricNoticeOptions) => service.notify(message, options)
  const open = (pageId?: string): void => { service.open(pageId === undefined ? undefined : scopedId(identity.id, pageId)) }
  const close = (): void => { service.close() }

  const pages = {
    define(definition: FabricPageDefinition): FabricPageHandle {
      const fullId = scopedId(identity.id, definition.id)
      const configHandles = new Map((definition.config ?? []).map(handle => [handle.id, handle]))
      const getConfig = <T extends JsonRecord = JsonRecord>(id: string): FabricConfigHandle<T> => {
        const handle = configHandles.get(id) as FabricConfigHandle<T> | undefined
        if (handle === undefined) throw new Error(`fabric page "${definition.id}" does not expose config "${id}"`)
        return handle
      }
      const pageContext = (raw: unknown): FabricPageProps => {
        const owner = raw as Partial<LegacyPageProps> & { sessionId?: unknown }
        const session = definition.scope === 'session' ? asSession(owner.sessionId) : undefined
        const page: FabricPageContext = {
          id: definition.id,
          pluginId: identity.id,
          session,
          signal: lifecycle.signal,
          resources,
          config: getConfig,
          open: pageId => { service.open(pageId === undefined ? fullId : scopedId(identity.id, pageId)) },
          close,
          notify,
        }
        return {
          page,
          session,
          sessionId: session?.id,
          resources,
          config: getConfig,
          openFabric: pageId => { page.open(pageId) },
          notify,
        }
      }
      const unregister = service.register({
        kind: 'page',
        id: fullId,
        label: definition.label,
        ...(definition.order === undefined ? {} : { order: definition.order }),
        ...(definition.icon === undefined ? {} : { icon: definition.icon }),
        ...(definition.badge === undefined ? {} : { badge: definition.badge }),
        ...(definition.keepAlive === undefined ? {} : { keepAlive: definition.keepAlive }),
        pluginId: identity.id,
        component: raw => createElement(definition.view, pageContext(raw)),
      })
      lifecycle.onDispose(unregister)

      for (const action of definition.actions ?? []) {
        const actionId = scopedId(identity.id, `${definition.id}.${action.id}`)
        const stopAction = service.register({
          kind: 'toolbar',
          id: actionId,
          ...(action.order === undefined ? {} : { order: action.order }),
          component: raw => {
            const owner = raw as LegacyActionProps
            const active = localPageId(identity.id, owner.activePage)
            if (active !== definition.id) return null
            return createElement(action.component, {
              pageId: definition.id,
              activePage: definition.id,
              open: pageId => { service.open(pageId === undefined ? fullId : scopedId(identity.id, pageId)) },
              close,
              notify,
            })
          },
        })
        lifecycle.onDispose(stopAction)
      }

      return { id: fullId, open: () => { service.open(fullId) } }
    },
    open,
    close,
  }

  const overlays = {
    define(definition: FabricOverlayDefinition): () => void {
      const configHandles = new Map((definition.config ?? []).map(handle => [handle.id, handle]))
      const getConfig = <T extends JsonRecord = JsonRecord>(id: string): FabricConfigHandle<T> => {
        const handle = configHandles.get(id) as FabricConfigHandle<T> | undefined
        if (handle === undefined) throw new Error(`fabric overlay "${definition.id}" does not expose config "${id}"`)
        return handle
      }
      const stop = service.register({
        kind: 'overlay',
        id: scopedId(identity.id, definition.id),
        ...(definition.order === undefined ? {} : { order: definition.order }),
        pluginId: identity.id,
        component: raw => {
          const owner = raw as LegacyPageProps & { fabricOpen?: boolean; activePage?: string }
          return createElement(definition.component, {
            pageId: localPageId(identity.id, owner.activePage),
            open: owner.fabricOpen === true,
            activePage: localPageId(identity.id, owner.activePage),
            openFabric: pageId => { service.open(pageId === undefined ? undefined : scopedId(identity.id, pageId)) },
            close,
            notify,
            config: getConfig,
          })
        },
      })
      lifecycle.onDispose(stop)
      return stop
    },
  }

  const commands = {
    define(definition: FabricCommandDefinition): () => void {
      const stop = service.register({
        kind: 'command',
        id: scopedId(identity.id, definition.id),
        title: definition.title,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        ...(definition.shortcut === undefined ? {} : { shortcut: definition.shortcut }),
        ...(definition.order === undefined ? {} : { order: definition.order }),
        pluginId: identity.id,
        handler: signal => definition.run(signal),
      })
      lifecycle.onDispose(stop)
      return stop
    },
  }

  const config = {
    define<T extends JsonRecord>(definition: FabricConfigDefinition<T>): FabricConfigHandle<T> {
      const id = configId(identity.id, definition.id)
      const stop = service.registerConfig({
        id,
        title: definition.title,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        pluginId: identity.id,
        schema: definition.schema,
      })
      lifecycle.onDispose(stop)
      const store = service.configs.requireStore(id) as import('../sdk/config.ts').ConfigStore<T>
      const handle: FabricConfigHandle<T> = {
        id,
        getSnapshot: () => store.getSnapshot(),
        subscribe: (listener: () => void) => store.subscribe(listener),
        set: (patch: Partial<T>) => { store.set(patch) },
        reset: () => { store.reset() },
        load: () => store.load(),
        persist: () => store.persist(),
      }
      if (definition.settings !== undefined) {
        const stopSettings = service.register({
          kind: 'settings',
          id: `${id}.settings`,
          pluginId: identity.id,
          component: raw => {
            const owner = raw as LegacySettingsProps
            return createElement(definition.settings!, {
              open: owner.openFabric,
              config: handle,
              resources,
              notify: owner.notify,
            })
          },
        })
        lifecycle.onDispose(stopSettings)
      }
      return handle
    },
  }

  const capabilities = {
    provide<T>(definition: FabricCapabilityDefinition<T>): FabricCapabilityHandle<T> {
      if (definition.id.trim() === '') throw new Error('fabric capability id must not be empty')
      const scope = definition.scope ?? 'profile'
      const stop = service.registerCapability(definition.id, definition.version, scope, definition.implementation)
      lifecycle.onDispose(stop)
      return {
        id: definition.id,
        version: definition.version,
        get: () => service.getCapability<T>(definition.id, definition.version, scope),
      }
    },
    require<T>(id: string, version?: string, scope: 'profile' | 'session' = 'profile'): T {
      const value = service.getCapability<T>(id, version, scope)
      if (value === undefined) throw new Error(`fabric capability "${id}" is unavailable${version === undefined ? '' : ` (requires ${version})`}`)
      return value
    },
    optional<T>(id: string, version?: string, scope: 'profile' | 'session' = 'profile'): T | undefined {
      return service.getCapability<T>(id, version, scope)
    },
  }

  const theme = {
    provide: (id: string, definition: FabricThemeDefinition, options?: { readonly priority?: number; readonly scope?: 'global' | 'workbench' }) => {
      const stop = service.theme.setSemantic(scopedId(identity.id, id), definition, options)
      lifecycle.onDispose(stop)
      return stop
    },
    clear: (id: string) => { service.theme.clearTokens(scopedId(identity.id, id)) },
    isDark: () => service.theme.isDark(),
    onChange: (listener: (theme: { readonly dark: boolean }) => void) => {
      const stop = service.theme.onThemeChange(listener)
      lifecycle.onDispose(stop)
      return stop
    },
  } satisfies FabricThemeProvider

  return {
    identity,
    lifecycle,
    pages,
    commands,
    config,
    overlays,
    capabilities,
    theme,
    resources,
    notify,
    open,
    close,
  }
}

export function mountClientPlugin(
  packageName: string,
  version: string,
  definition: FabricClientPluginDefinition,
): { readonly inject: readonly ['fabric']; readonly apply: (ctx: unknown) => void } {
  const identity: FabricPluginIdentity = {
    id: runtimePluginId(packageName),
    packageName,
    version,
    name: definition.descriptor.name,
    ...(definition.descriptor.description === undefined ? {} : { description: definition.descriptor.description }),
    ...(definition.descriptor.icon === undefined ? {} : { icon: definition.descriptor.icon }),
  }
  return {
    inject: ['fabric'],
    apply(rawContext: unknown): void {
      const ctx = rawContext as DshContext
      const service = ctx.fabric
      if (service === undefined) throw new Error(`fabric plugin "${identity.id}" started before the Fabric runtime`)
      const controller = new AbortController()
      const cleanups = new Set<() => void>()
      const lifecycle: FabricLifecycle = {
        signal: controller.signal,
        onDispose(cleanup) { cleanups.add(cleanup) },
      }
      const stopMod = service.register({
        kind: 'mod',
        id: identity.id,
        name: identity.name,
        version,
        ...(identity.description === undefined ? {} : { description: identity.description }),
        ...(identity.icon === undefined ? {} : { icon: identity.icon }),
      })
      lifecycle.onDispose(stopMod)
      const pluginContext = makeClientContext(identity, service, lifecycle)
      let setupCleanup: void | (() => void)
      try {
        setupCleanup = definition.setup(pluginContext)
      } catch (error) {
        controller.abort()
        for (const cleanup of [...cleanups].reverse()) cleanup()
        cleanups.clear()
        throw error
      }
      if (setupCleanup !== undefined) lifecycle.onDispose(setupCleanup)
      ctx.effect(() => () => {
        controller.abort()
        for (const cleanup of [...cleanups].reverse()) cleanup()
        cleanups.clear()
      }, `fabric plugin: ${identity.id}`)
    },
  }
}

export type { FabricNoticeOptions, FabricNoticeTone }
export type { FabricResourceClient, FabricResourceDefinition, FabricResourceHandlers, FabricSessionRef }
export type { FabricThemeDefinition, FabricThemeProvider }
