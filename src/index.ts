import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { FabricConfigRepository } from './host/config-store.ts'
import { parseConfigSchema, validateConfigValues } from './sdk/config.ts'
import { FabricResourceHostService, resourceRouteHandler, assetRouteHandler, FABRIC_RESOURCE_PREFIX, FABRIC_ASSET_PREFIX } from './host/resources.ts'
import { fabricConfigResource } from './resource/config.ts'
import { FabricResourceError } from './resource/contract.ts'

export { defineHostPlugin, mountHostPlugin } from './host/plugin.ts'
export type { FabricHostLifecycle, FabricHostPluginContext, FabricHostPluginDefinition, FabricHostPluginDescriptor, FabricHostPluginIdentity } from './host/plugin.ts'
export { assetUrl, FabricResourceError, defineCodec, defineResource, jsonCodec, voidCodec } from './resource/contract.ts'
export { fabricConfigResource } from './resource/config.ts'
export type {
  FabricAssetContext, FabricAssetHandler, FabricAssetHost, FabricAssetResponse,
  FabricCodec, FabricResourceContext, FabricResourceDefinition, FabricResourceEmitter,
  FabricResourceHandler, FabricResourceHandlers, FabricResourceHost, FabricPluginResourceHost, FabricResourceScope,
  FabricResourceStreamHandler, FabricSessionRef,
} from './resource/contract.ts'
export type { FabricConfigDocument, FabricConfigRequest, FabricConfigReadRequest, FabricConfigWriteRequest, FabricConfigValues } from './resource/config.ts'
export { FabricResourceHostService, FABRIC_RESOURCE_PREFIX, FABRIC_ASSET_PREFIX }

/** Host half: persist Fabric config documents through the typed Resource dispatcher. */
export const inject = ['webServer'] as const

/** Host runtime: one resource dispatcher and one config repository per DSH profile. */
export function apply(ctx: Context): void {
  const resources = new FabricResourceHostService()
  ctx.provide('fabricHost', resources)
  ctx.inject(['webServer'], webCtx => {
    const repository = new FabricConfigRepository()
    const schemas = new Map<string, string>()
    const getSchema = (id: string, rawSchema: unknown) => {
      const schema = parseConfigSchema(rawSchema)
      const serialized = JSON.stringify(schema)
      const previous = schemas.get(id)
      if (previous !== undefined && previous !== serialized) {
        throw new FabricResourceError({ code: 'config-schema-conflict', message: `config "${id}" was registered with a different schema` })
      }
      schemas.set(id, serialized)
      return schema
    }
    resources.provide('fabric', fabricConfigResource, {
      query: async request => {
        if (request.operation !== 'read') throw new FabricResourceError({ code: 'operation-not-supported', message: 'config query requires read operation' })
        const schema = getSchema(request.id, request.schema)
        try {
          const document = await repository.read(request.id)
          return { ...document, values: validateConfigValues(schema, document.values) }
        } catch (error) {
          if (error instanceof FabricResourceError) throw error
          throw new FabricResourceError({ code: 'config-invalid', message: error instanceof Error ? error.message : String(error) })
        }
      },
      mutate: async request => {
        if (request.operation !== 'write') throw new FabricResourceError({ code: 'operation-not-supported', message: 'config mutation requires write operation' })
        const schema = getSchema(request.id, request.schema)
        let values
        try {
          values = validateConfigValues(schema, request.values)
        } catch (error) {
          throw new FabricResourceError({ code: 'config-invalid', message: error instanceof Error ? error.message : String(error) })
        }
        const result = await repository.write(request.id, request.seq, values)
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
      return () => {
        stopAssets()
        stopResources()
      }
    }, 'fabric: host routes')
  })
}
