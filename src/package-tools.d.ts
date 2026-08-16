declare module 'pacote' {
  export interface PacoteManifest {
    readonly name: string
    readonly version: string
    readonly _resolved?: string
    readonly _integrity?: string
    readonly dist?: { readonly tarball?: string; readonly integrity?: string }
  }
  export interface PacoteOptions extends Record<string, unknown> {
    readonly integrity?: string
  }
  interface Pacote {
    manifest(spec: string, options?: PacoteOptions): Promise<PacoteManifest>
    tarball: {
      file(spec: string, destination: string, options?: PacoteOptions): Promise<string>
    }
  }
  const pacote: Pacote
  export default pacote
}

declare module 'npm-package-arg' {
  export interface Result {
    readonly type: string
    readonly name?: string
    readonly rawSpec: string
    readonly fetchSpec?: string
    readonly saveSpec?: string
    readonly registry?: boolean
  }
  export default function npa(spec: string): Result
}

declare module '@npmcli/config' {
  export interface NpmConfigOptions {
    readonly definitions: Record<string, unknown>
    readonly shorthands: Record<string, unknown>
    readonly flatten: (value: Record<string, unknown>) => Record<string, unknown>
    readonly nerfDarts?: readonly string[]
    readonly npmPath: string
    readonly argv?: readonly string[]
    readonly cwd?: string
  }
  export default class Config {
    constructor(options: NpmConfigOptions)
    load(): Promise<void>
    readonly flat: Record<string, unknown>
  }
}

declare module '@npmcli/config/lib/definitions/index.js' {
  const value: {
    readonly definitions: Record<string, unknown>
    readonly shorthands: Record<string, unknown>
    readonly flatten: (input: Record<string, unknown>) => Record<string, unknown>
    readonly nerfDarts: readonly string[]
  }
  export default value
}
