/**
 * Type-level probe for the hand-written public declarations in types/.
 * Compiled with tests/types-probe/tsconfig.json (paths -> types/*.d.ts).
 * This is the drift gate: source changes that are not reflected in the
 * declarations fail this file's compile.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import {
  defineCapability, defineClientPlugin, defineCodec, defineCredential, defineOperation, defineResource, FabricResourceError, jsonCodec,
  type FabricClientPluginContext, type FabricConfigHandle, type FabricPageProps,
  type FabricResourceClient, type FabricThemeDefinition, type JsonRecord, type JsonValue,
} from '@dsh-do/fabric/client'
import {
  assetUrl, defineHostPlugin, FabricResourceHostService, FABRIC_ASSET_PREFIX,
  FABRIC_RESOURCE_PREFIX, mountHostPlugin,
  type FabricHostPluginContext, type FabricPluginResourceHost,
} from '@dsh-do/fabric'
import { defineCapability as defineContractCapability, defineResource as defineContractResource } from '@dsh-do/fabric/contracts'
import { createAsyncResource, type AsyncResource, type ConfigStore, type EventStream, type FabricConfigSchema, type JsonValue as SdkJsonValue, type Observable } from '@dsh-do/fabric/sdk'
import { Badge, ErrorState, Modal, Page, useFabricConfig, Z_INDEX, type BadgeTone } from '@dsh-do/fabric/ui'
import { fabricClient, fabricRuntimePackage, type FabricClientBuildOptions } from '@dsh-do/fabric/build'
// @ts-expect-error the 0.x static profile-bundle preset was removed in Fabric 1.0
import { fabricPlugin } from '@dsh-do/fabric/build'
import { parseCreateArgs, scaffoldPlugin } from '@dsh-do/fabric/create'

// --- removed public API must stay removed ---
// @ts-expect-error createJsonClient was removed in 0.5; the raw HTTP client is not part of the contract
import { createJsonClient } from '@dsh-do/fabric/sdk'
// @ts-expect-error createEventStream is an internal transport detail, not public
import { createEventStream } from '@dsh-do/fabric/sdk'
void createJsonClient
void createEventStream

// --- resources ---
interface PingRequest { readonly n: number }
interface PingResponse { readonly doubled: number }

const pingCodec = defineCodec<PingRequest>(value => ({ n: Number((value as PingRequest).n) }))
void defineContractCapability
void defineContractResource
const pingCapability = defineCapability<{ ping(): number }>({
  owner: '@example/probe', id: 'api', version: '1', side: 'client',
})
const apiKey = defineCredential({
  owner: '@example/probe', id: 'api-key', version: '1', ref: 'EXAMPLE_API_KEY',
})
const pingOperation = defineOperation<PingRequest, PingResponse>({
  owner: '@example/probe', id: 'ping', version: '1', input: pingCodec, result: jsonCodec as never,
})
const pingResource = defineResource<PingRequest, PingResponse>({
  owner: '@example/probe',
  id: 'ping',
  version: '1',
  scope: 'profile',
  request: pingCodec,
  response: jsonCodec as never,
})

// --- client plugin ---
const definition = defineClientPlugin({
  descriptor: { name: 'probe', icon: createElement('span') },
  setup(ctx: FabricClientPluginContext) {
    ctx.lifecycle.onDispose(() => {})
    void ctx.resources.read(pingResource, { n: 1 })
    void ctx.resources.mutate(pingResource, { n: 2 })
    void ctx.resources.watch(pingResource as never, { n: 3 })
    ctx.theme.provide('theme', {} as FabricThemeDefinition, { priority: 100, scope: 'global' })
    const config: FabricConfigHandle<{ enabled?: boolean }> = ctx.config.define({
      id: 'prefs',
      title: 'Prefs',
      schema: { enabled: { type: 'boolean', title: 'Enabled', default: true } },
    })
    const page = ctx.pages.define({
      id: 'home',
      label: 'Home',
      view: (_props: FabricPageProps) => null,
      actions: [{ id: 'refresh', label: 'Refresh', onClick: ({ notify }) => { notify('refreshed') } }],
      config: [config],
    })
    page.setBadge(1)
    ctx.dialogs.open({ id: 'welcome', title: 'Welcome', content: 'Hello' }).close()
    ctx.commands.define({ id: 'open', title: 'Open', run: () => {} })
    ctx.capabilities.provide(pingCapability, { ping: () => 1 })
    const api = ctx.capabilities.consume(pingCapability)
    void api.getSnapshot().value?.ping()
    void ctx.credentials.describe(apiKey)
    void ctx.operations.start(pingOperation, { n: 1 })
    // @ts-expect-error legacy inline capability implementations were removed in 1.0
    ctx.capabilities.provide({ id: 'api', version: '1', implementation: { ping: () => 1 } })
    ctx.hud.define({ id: 'hud', component: () => null })
    // @ts-expect-error overlays was replaced by the narrow hud API in 0.7
    ctx.overlays.define({ id: 'legacy', component: () => null })
    ctx.pages.define({
      id: 'legacy-action', label: 'Legacy', view: () => null,
      // @ts-expect-error action.component was replaced by declarative actions or action.render
      actions: [{ id: 'old', component: () => null }],
    })
    ctx.notify('hello', { tone: 'success' })
  },
})
void definition

// --- host plugin ---
const hostDefinition = defineHostPlugin({
  descriptor: { name: 'probe-host' },
  setup(ctx: FabricHostPluginContext) {
    const resources: FabricPluginResourceHost = ctx.resources
    resources.provide(pingResource, {
      query: async request => ({ doubled: request.n * 2 }),
    })
    resources.assets.provide('img', async () => ({ contentType: 'image/png', body: new Uint8Array() }))
    ctx.lifecycle.onDispose(() => {})
  },
})
void mountHostPlugin('probe-host', '0.1.0', hostDefinition)
void new FabricResourceHostService()
void FABRIC_RESOURCE_PREFIX
void FABRIC_ASSET_PREFIX
void assetUrl('probe-host', 'img', 'a.png')

// --- ui kit ---
const badgeTone: BadgeTone = 'success'
void badgeTone
void Z_INDEX.BASE
void ((): ReactNode => (
  <Page>
    <Badge tone="info">ok</Badge>
    <ErrorState error="boom" retry={() => {}} />
    <Modal open={false} onClose={() => {}} title="m">m</Modal>
  </Page>
))
void useFabricConfig

// --- sdk surface ---
const schema: FabricConfigSchema = { enabled: { type: 'boolean', title: 'Enabled' } }
void schema
const asyncResource: AsyncResource<number> = createAsyncResource(async signal => {
  void signal
  return 1
})
void asyncResource.load()
const observable: Observable<ReturnType<AsyncResource<number>['getSnapshot']>> = asyncResource
void observable.getSnapshot()
type StoreAlias = ConfigStore<{ enabled?: boolean }>
declare const store: StoreAlias
void store.persist()
type StreamAlias = EventStream<string>
declare const stream: StreamAlias
void stream.start()
const raw: JsonValue = { a: [1, null, 'x'] }
const sdkJson: SdkJsonValue = raw
void sdkJson
const record: JsonRecord = { enabled: true }
void record

// --- build & create ---
const buildOptions: FabricClientBuildOptions = { id: 'probe' }
void fabricClient(buildOptions)
void fabricRuntimePackage({ id: 'probe' })
void fabricPlugin
void parseCreateArgs(['--name', 'probe-plugin'])
void scaffoldPlugin({ directory: '.', name: 'probe-plugin' })
