import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { FabricConfigRepository } from './host/config-store.ts'
import { parseConfigSchema, validateConfigValues } from './sdk/config.ts'
import { FabricResourceHostService, resourceRouteHandler, assetRouteHandler, FABRIC_RESOURCE_PREFIX, FABRIC_ASSET_PREFIX } from './host/resources.ts'
import {
  FABRIC_RUNTIME_INVENTORY_EVENTS_PATH, FABRIC_RUNTIME_INVENTORY_PATH, FABRIC_RUNTIME_PACKAGE_PREFIX,
  FabricInventoryStore, FabricPackageStore, LocalFabricPackageManager,
  runtimeInventoryEventsRouteHandler, runtimeInventoryRouteHandler, runtimePackageRouteHandler,
} from './host/package-store.ts'
import { FabricRuntimeHostManager, profileRootFromContext } from './runtime/host-manager.ts'
import {
  FABRIC_RUNTIME_CLIENT_STATUS_PATH, FabricRuntimeClientRegistry, runtimeClientStatusRouteHandler,
} from './host/runtime-clients.ts'
import { FabricDocumentService } from './host/documents.ts'
import { FabricBlobService, fabricBlobRouteHandler } from './host/blobs.ts'
import { FABRIC_BLOB_PREFIX } from './blob/contract.ts'
import { fabricOperationRouteHandler } from './host/operations.ts'
import { provideFabricPackageControls } from './host/package-controls.ts'
import {
  FabricCredentialService, provideFabricCredentialResource, type DshCredentialProvider,
} from './host/credentials.ts'
import { FABRIC_OPERATION_PREFIX } from './operation/contract.ts'
import { fabricConfigResource } from './resource/config.ts'
import { FabricResourceError } from './resource/contract.ts'
import { writeFabricRuntimeDiscovery } from './runtime/discovery.ts'
import { FABRIC_DEV_PREFIX, FabricDevRuntimeManager, fabricDevRouteHandler } from './host/dev-runtime.ts'

export { defineHostPlugin, mountHostPlugin } from './host/plugin.ts'
export type {
  FabricHostDisposer, FabricHostLifecycle, FabricHostPluginContext, FabricHostPluginDefinition,
  FabricHostPluginDescriptor, FabricHostPluginIdentity,
} from './host/plugin.ts'
export { assetUrl, FabricResourceError, defineCodec, defineResource, jsonCodec, voidCodec } from './resource/contract.ts'
export { defineCapability } from './capability/contract.ts'
export { defineCredential } from './credential/contract.ts'
export type {
  FabricCredentialDefinition, FabricCredentialInfo, FabricResolvedCredential,
} from './credential/contract.ts'
export type {
  FabricCapabilityBinding, FabricCapabilityDefinition, FabricCapabilityProviderHandle,
  FabricCapabilitySide, FabricCapabilitySnapshot, FabricCapabilityStatus,
} from './capability/contract.ts'
export { defineOperation, FabricOperationRegistry, FABRIC_OPERATION_PREFIX } from './operation/contract.ts'
export { defineDocument, FabricDocumentConflictError } from './document/contract.ts'
export { fabricBlobUrl, FABRIC_BLOB_PREFIX } from './blob/contract.ts'
export type {
  FabricBlobPutInput, FabricBlobRef, FabricBlobValue, FabricPluginBlobHost,
} from './blob/contract.ts'
export type {
  FabricDocumentDefinition, FabricDocumentHandle, FabricDocumentSnapshot, FabricPluginDocumentHost,
} from './document/contract.ts'
export type {
  FabricOperationDefinition, FabricOperationHandle, FabricOperationHandler, FabricOperationHost,
  FabricOperationRunContext, FabricOperationSnapshot, FabricOperationStatus, FabricPluginOperationHost,
} from './operation/contract.ts'
export {
  assertRuntimeBundlePurity, runtimeModuleId, validateFabricRuntimePackageManifest,
  FABRIC_RUNTIME_FORMAT,
} from './runtime/manifest.ts'
export type {
  FabricRuntimeManifest, FabricRuntimeManifestValidationOptions, FabricRuntimePackageManifest,
} from './runtime/manifest.ts'
export { fabricConfigResource } from './resource/config.ts'
export type {
  FabricAssetContext, FabricAssetHandler, FabricAssetHost, FabricAssetResponse,
  FabricCodec, FabricResourceContext, FabricResourceDefinition, FabricResourceEmitter,
  FabricResourceHandler, FabricResourceHandlers, FabricResourceHost, FabricPluginResourceHost, FabricResourceScope,
  FabricResourceStreamHandler,
} from './resource/contract.ts'
export type { FabricSessionRef } from './session.ts'
export type { FabricConfigDocument, FabricConfigRequest, FabricConfigReadRequest, FabricConfigWriteRequest, FabricConfigValues } from './resource/config.ts'
export { FabricResourceHostService, FABRIC_RESOURCE_PREFIX, FABRIC_ASSET_PREFIX }
export {
  FABRIC_RUNTIME_PACKAGE_PREFIX, FabricInventoryStore, FabricPackageStore, LocalFabricPackageManager,
  encodeFabricPackageName, runtimePackageRouteHandler,
} from './host/package-store.ts'
export { FabricRuntimeHostManager, profileRootFromContext } from './runtime/host-manager.ts'
export { emptyFabricInventory, parseFabricInventory, FABRIC_INVENTORY_FORMAT } from './runtime/inventory.ts'
export type {
  FabricInventory, FabricInventoryEntry,
} from './runtime/inventory.ts'
export type {
  FabricPackageManager, InstalledFabricPackage,
} from './host/package-store.ts'
export type { FabricRuntimeHostState, FabricRuntimeHostStatus } from './runtime/host-manager.ts'
export {
  FABRIC_RUNTIME_DISCOVERY_FILE, FABRIC_RUNTIME_DISCOVERY_FORMAT, parseFabricRuntimeDiscovery,
} from './runtime/discovery.ts'
export type { FabricRuntimeDiscovery } from './runtime/discovery.ts'
export { FABRIC_DEV_PREFIX, FabricDevRuntimeManager, fabricDevRouteHandler } from './host/dev-runtime.ts'

/** Host half: persist Fabric config documents through the typed Resource dispatcher. */
export const inject = ['webServer', 'credentials'] as const

/** Host runtime: one resource dispatcher and one config repository per DSH profile. */
export function apply(ctx: Context): void {
  const profileRoot = profileRootFromContext(ctx)
  const inventoryStore = profileRoot === undefined ? undefined : new FabricInventoryStore(profileRoot)
  const documents = profileRoot === undefined ? undefined : new FabricDocumentService(profileRoot)
  const blobs = profileRoot === undefined ? undefined : new FabricBlobService(profileRoot)
  const credentialProvider = (ctx as Context & { readonly credentials: DshCredentialProvider }).credentials
  const credentials = new FabricCredentialService(credentialProvider)
  const resources = new FabricResourceHostService(documents, blobs, credentials)
  ctx.provide('fabricHost', resources)
  const stopCredentialResource = provideFabricCredentialResource(resources, credentials)
  ctx.effect(() => () => {
    stopCredentialResource()
    credentials.dispose()
  }, 'fabric: credentials')
  const configRoot = profileRoot === undefined ? undefined : join(profileRoot, '.fabric', 'data')
  const legacyConfigRoot = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'fabric', 'config')
  const repository = new FabricConfigRepository(configRoot, legacyConfigRoot)
  const packageStore = inventoryStore === undefined ? undefined : new FabricPackageStore(inventoryStore)
  const runtimeClients = packageStore === undefined ? undefined : new FabricRuntimeClientRegistry()
  const packageManager = packageStore === undefined ? undefined : new LocalFabricPackageManager(packageStore, '1.0.0')
  const hostManager = packageStore === undefined ? undefined : new FabricRuntimeHostManager(ctx, packageStore)
  let devManager: FabricDevRuntimeManager | undefined
  if (packageManager !== undefined && hostManager !== undefined && runtimeClients !== undefined && packageStore !== undefined) {
    ctx.provide('fabricRuntime', { packages: packageManager, hosts: hostManager })
    const hostReady = packageStore.cleanDevPackages().then(() => hostManager.start())
    devManager = new FabricDevRuntimeManager(packageStore, hostManager, runtimeClients, '1.0.0', hostReady)
    void hostReady.catch(error => {
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
    })
    const stopControls = provideFabricPackageControls(resources, packageManager, hostManager, hostReady, runtimeClients, devManager)
    ctx.effect(() => {
      return () => {
        stopControls()
        void devManager?.dispose().finally(() => hostManager.dispose())
      }
    }, 'fabric: runtime package manager')
  }
  ctx.inject(['webServer'], webCtx => {
    const schemas = new Map<string, string>()
    const getSchema = (owner: string, id: string, rawSchema: unknown) => {
      const schema = parseConfigSchema(rawSchema)
      const serialized = JSON.stringify(schema)
      const key = `${owner}\u0000${id}`
      const previous = schemas.get(key)
      if (previous !== undefined && previous !== serialized) {
        throw new FabricResourceError({ code: 'config-schema-conflict', message: `config "${owner}/${id}" was registered with a different schema` })
      }
      schemas.set(key, serialized)
      return schema
    }
    resources.provide('@dsh-do/fabric', fabricConfigResource, {
      query: async request => {
        if (request.operation !== 'read') throw new FabricResourceError({ code: 'operation-not-supported', message: 'config query requires read operation' })
        const schema = getSchema(request.owner, request.id, request.schema)
        try {
          const document = await repository.read(request.owner, request.id)
          return { ...document, values: validateConfigValues(schema, document.values) }
        } catch (error) {
          if (error instanceof FabricResourceError) throw error
          throw new FabricResourceError({ code: 'config-invalid', message: error instanceof Error ? error.message : String(error) })
        }
      },
      mutate: async request => {
        if (request.operation !== 'write') throw new FabricResourceError({ code: 'operation-not-supported', message: 'config mutation requires write operation' })
        const schema = getSchema(request.owner, request.id, request.schema)
        let values
        try {
          values = validateConfigValues(schema, request.values)
        } catch (error) {
          throw new FabricResourceError({ code: 'config-invalid', message: error instanceof Error ? error.message : String(error) })
        }
        const result = await repository.write(request.owner, request.id, request.seq, values)
        if (!result.ok) {
          throw new FabricResourceError({
            code: 'config-conflict',
            message: `config "${request.id}" changed on the host`,
            details: result.conflict,
            retryable: true,
          })
        }
        return result.document
      },
    })
    webCtx.effect(() => {
      const stopResources = webCtx.webServer.register({
        kind: 'prefix',
        path: FABRIC_RESOURCE_PREFIX,
        handler: resourceRouteHandler(resources),
      })
      const stopAssets = webCtx.webServer.register({
        kind: 'prefix',
        path: FABRIC_ASSET_PREFIX,
        handler: assetRouteHandler(resources),
      })
      const stopRuntime = packageStore === undefined ? undefined : webCtx.webServer.register({
        kind: 'prefix',
        path: FABRIC_RUNTIME_PACKAGE_PREFIX,
        handler: runtimePackageRouteHandler(packageStore),
      })
      const stopInventory = packageStore === undefined ? undefined : webCtx.webServer.register({
        kind: 'exact',
        path: FABRIC_RUNTIME_INVENTORY_PATH,
        handler: runtimeInventoryRouteHandler(packageStore),
      })
      const stopInventoryEvents = packageStore === undefined ? undefined : webCtx.webServer.register({
        kind: 'exact',
        path: FABRIC_RUNTIME_INVENTORY_EVENTS_PATH,
        handler: runtimeInventoryEventsRouteHandler(packageStore, runtimeClients),
      })
      const stopRuntimeClientStatus = runtimeClients === undefined ? undefined : webCtx.webServer.register({
        kind: 'exact',
        path: FABRIC_RUNTIME_CLIENT_STATUS_PATH,
        handler: runtimeClientStatusRouteHandler(runtimeClients),
      })
      const stopBlobs = blobs === undefined || inventoryStore === undefined ? undefined : webCtx.webServer.register({
        kind: 'prefix',
        path: FABRIC_BLOB_PREFIX,
        handler: fabricBlobRouteHandler(blobs, inventoryStore),
      })
      const stopOperations = webCtx.webServer.register({
        kind: 'prefix',
        path: FABRIC_OPERATION_PREFIX,
        handler: fabricOperationRouteHandler(resources.operations),
      })
      const stopDev = devManager === undefined ? undefined : webCtx.webServer.register({
        kind: 'prefix',
        path: FABRIC_DEV_PREFIX,
        handler: fabricDevRouteHandler(devManager),
      })
      const discovery = profileRoot === undefined
        ? undefined
        : writeFabricRuntimeDiscovery(profileRoot, webCtx.webServer.port, '1.0.0').catch(error => {
            webCtx.logger.error(error instanceof Error ? error : new Error(String(error)))
            return undefined
          })
      return async () => {
        await (await discovery)?.()
        stopDev?.()
        stopOperations()
        stopBlobs?.()
        stopRuntimeClientStatus?.()
        stopInventoryEvents?.()
        stopInventory?.()
        stopRuntime?.()
        stopAssets()
        stopResources()
      }
    }, 'fabric: host routes')
  })
}
