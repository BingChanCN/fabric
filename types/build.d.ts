import type { UserConfig } from 'tsdown/config'

/** DSH module-table entries kept external by Fabric's client preset. */
export declare const FABRIC_CLIENT_EXTERNALS: readonly [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

export interface FabricClientBuildOptions {
  id: string
  entry?: string
  outDir?: string
  external?: readonly string[]
  sourcemap?: boolean
}

export interface FabricPluginBuildOptions extends FabricClientBuildOptions {
  hostEntry?: string | false
  hostTarget?: string
}

/** Build one precompiled DSH browser half with CSS Modules inlined. */
export declare function fabricClient(options: FabricClientBuildOptions): UserConfig

/** Build conventional Node and browser halves for a Fabric-aware DSH plugin. */
export declare function fabricPlugin(options: FabricPluginBuildOptions): UserConfig[]
