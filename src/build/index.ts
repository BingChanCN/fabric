import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { UserConfig } from 'tsdown/config'
import { transform } from 'lightningcss'

/** Module-table entries supplied by the DSH web shell. */
export const FABRIC_CLIENT_EXTERNALS = [
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
] as const

export interface FabricClientBuildOptions {
  /** Package name used by the DSH module table and style ownership. Defaults to package.json name. */
  id?: string
  /** Browser definition entry. Generated bootstrap imports its default export. */
  entry?: string
  /** Build the Fabric runtime itself instead of a generated downstream bootstrap. */
  runtime?: boolean
  /** Artifact directory. @default "lib" */
  outDir?: string
  /** Additional DSH module-table entries that must remain external. */
  external?: readonly string[]
  /** Emit a browser sourcemap. @default true */
  sourcemap?: boolean
}

export interface FabricPluginBuildOptions extends FabricClientBuildOptions {
  /** Node-side Cordis entry. Set false for a client-only package. @default "src/index.ts" */
  hostEntry?: string | false
  /** Node compilation target. @default "node22" */
  hostTarget?: string
}

type WatchContext = { addWatchFile(file: string): void }

const CSS_PREFIX = '\0fabric-plugin-css:'
const CSS_SUFFIX = '.mjs'

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function packageMetadata(): { name: string; version: string } {
  const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown }
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') throw new Error('fabric build: package.json name is required')
  if (typeof parsed.version !== 'string' || parsed.version.trim() === '') throw new Error('fabric build: package.json version is required')
  return { name: parsed.name, version: parsed.version }
}

function requirePluginId(id: string | undefined): string {
  const packageName = packageMetadata().name
  const normalized = (id ?? packageName).trim()
  if (normalized === '') throw new Error('fabric build: plugin id must not be empty')
  if (normalized !== packageName) {
    throw new Error(`fabric build: plugin id "${normalized}" must equal package.json name "${packageName}"`)
  }
  return packageName
}

function cssModules(pluginId: string) {
  return {
    name: 'fabric-css-modules-inline',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return CSS_PREFIX + resolve(dirname(importer), source) + CSS_SUFFIX
    },
    async load(this: WatchContext, id: string) {
      if (!id.startsWith(CSS_PREFIX) || !id.endsWith(CSS_SUFFIX)) return null
      const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(file)
      const result = transform({
        filename: file,
        code: await readFile(file),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      for (const [local, entry] of Object.entries(result.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        classes[local] = entry.name
      }
      const tagId = `${pluginId}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(result.code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        "if (typeof document !== 'undefined') {",
        "  let tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']');",
        "  if (tag === null) {",
        "    tag = document.createElement('style');",
        `    tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
        '    tag.dataset.pluginCss = tagId;',
        '    document.head.appendChild(tag);',
        '  }',
        '  tag.textContent = css;',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

/**
 * Build one DSH browser plugin bundle. Fabric SDK/UI value imports are inlined;
 * the framework service itself is consumed through `ctx.fabric`.
 */
export function fabricClient(options: FabricClientBuildOptions = {}): UserConfig {
  const metadata = packageMetadata()
  const id = requirePluginId(options.id)
  const version = metadata.version
  const external = unique([...FABRIC_CLIENT_EXTERNALS, ...(options.external ?? [])])
  const sourceEntry = resolve(process.cwd(), options.entry ?? 'src/client/index.ts')
  const bootstrapId = `\0fabric-bootstrap:${id}`
  const bootstrap = {
    name: 'fabric-generated-client-bootstrap',
    resolveId(source: string) {
      return source === bootstrapId ? bootstrapId : null
    },
    load(source: string) {
      if (source !== bootstrapId) return null
      if (options.runtime === true) return null
      return [
        `import definition from ${JSON.stringify(sourceEntry)};`,
        `import { mountClientPlugin } from '@dsh-do/fabric';`,
        `const mounted = mountClientPlugin(${JSON.stringify(id)}, ${JSON.stringify(version)}, definition);`,
        'export const inject = mounted.inject;',
        'export const apply = mounted.apply;',
      ].join('\n')
    },
  }
  const entry = options.runtime === true ? (options.entry ?? 'src/client/index.ts') : bootstrapId
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: options.outDir ?? 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: options.sourcemap ?? true,
    clean: false,
    deps: {
      neverBundle: external,
      alwaysBundle: (source: string) => external.includes(source) ? false : true,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [bootstrap, {
      name: 'fabric-runtime-import-boundary',
      resolveId(source: string) {
        if (source.startsWith('@dsh-do/fabric/')) {
          return { id: '@dsh-do/fabric', external: true }
        }
        return null
      },
    }, cssModules(id)],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}

/** Build the conventional Node and browser halves of a Fabric-aware DSH plugin. */
export function fabricPlugin(options: FabricPluginBuildOptions = {}): UserConfig[] {
  const id = requirePluginId(options.id)
  const client = fabricClient({
    id,
    ...(options.entry === undefined ? {} : { entry: options.entry }),
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
    ...(options.external === undefined ? {} : { external: options.external }),
    ...(options.sourcemap === undefined ? {} : { sourcemap: options.sourcemap }),
  })
  if (options.hostEntry === false) return [client]
  return [{
    name: id,
    entry: { index: options.hostEntry ?? 'src/index.ts' },
    outDir: options.outDir ?? 'lib',
    format: 'esm',
    platform: 'node',
    target: options.hostTarget ?? 'node22',
    dts: false,
    sourcemap: options.sourcemap ?? true,
    clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//, '@dsh-do/fabric'] },
    outputOptions: { entryFileNames: '[name].js' },
  }, client]
}
