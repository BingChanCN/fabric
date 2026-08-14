export interface ScaffoldOptions {
  directory: string
  name: string
}

export declare function parseCreateArgs(argv: readonly string[]): ScaffoldOptions
export declare function renderScaffold(name: string): Record<string, string>
export declare function scaffoldPlugin(options: ScaffoldOptions): Promise<readonly string[]>
