import type { UserConfig } from 'tsdown/config'

/** DSH module-table entries kept external by Fabric's client preset. */
export declare const FABRIC_CLIENT_EXTERNALS: readonly [
  '@dsh-do/fabric',
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
  /** Package name used by the DSH module table. Must equal package.json name. */
  id?: string
  /** Browser definition entry. Generated bootstrap imports its default export. */
  entry?: string
  /** Build the Fabric runtime itself instead of a generated downstream bootstrap. */
  runtime?: boolean
  outDir?: string
  external?: readonly string[]
  sourcemap?: boolean
}

export interface FabricPluginBuildOptions extends FabricClientBuildOptions {
  hostEntry?: string | false
  hostTarget?: string
}

/** Build one precompiled DSH browser half. Downstream bundles consume `@dsh-do/fabric`. */
export declare function fabricClient(options?: FabricClientBuildOptions): UserConfig

/** Build conventional Node and browser halves for a Fabric-aware DSH plugin. */
export declare function fabricPlugin(options?: FabricPluginBuildOptions): UserConfig[]
