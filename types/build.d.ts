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

export declare const FABRIC_RUNTIME_CLIENT_EXTERNALS: readonly ['@dsh-do/fabric', 'react', 'react/jsx-runtime']

export interface FabricClientBuildOptions {
  /** Package name used by the DSH module table and style ownership. */
  id?: string
  /** Browser definition entry. Generated bootstrap imports its default export. */
  entry?: string
  /** Build the Fabric runtime itself instead of a generated downstream bootstrap. */
  runtime?: boolean
  outDir?: string
  external?: readonly string[]
  moduleId?: string
  runtimePackage?: boolean
  fileName?: string
  sourcemap?: boolean
}

/** Build one precompiled DSH browser half. Downstream bundles consume `@dsh-do/fabric`. */
export declare function fabricClient(options?: FabricClientBuildOptions): UserConfig

export interface FabricRuntimePackageBuildOptions {
  hostEntry?: string | false
  clientEntry?: string | false
  id?: string
  outDir?: string
  hostTarget?: string
  clientTarget?: string
  clientExternal?: readonly string[]
  contractsEntry?: string | false
  sourcemap?: boolean
}

/** Build the hot-loadable Fabric Runtime Package format. */
export declare function fabricRuntimePackage(options?: FabricRuntimePackageBuildOptions): UserConfig[]
