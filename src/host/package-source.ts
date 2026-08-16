import Config from '@npmcli/config'
import npmDefinitions from '@npmcli/config/lib/definitions/index.js'
import npa from 'npm-package-arg'
import pacote, { type PacoteManifest, type PacoteOptions } from 'pacote'
import { extract, list, type ReadEntry } from 'tar'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY_SOURCE_TYPES = new Set(['tag', 'version', 'range'])
const ARCHIVE_ENTRY_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory'])

export interface FabricResolvedPackageSource {
  readonly kind: 'directory' | 'archive'
  readonly source: string
  readonly directory?: string
  readonly fetchSpec?: string
  readonly expectedName?: string
  readonly expectedVersion?: string
  readonly integrity?: string
  readonly pacoteOptions?: PacoteOptions
}

export interface FabricPackageFetcher {
  manifest(spec: string, options?: PacoteOptions): Promise<PacoteManifest>
  tarballFile(spec: string, destination: string, options?: PacoteOptions): Promise<string>
}

const defaultFetcher: FabricPackageFetcher = {
  manifest: (spec, options) => pacote.manifest(spec, options),
  tarballFile: (spec, destination, options) => pacote.tarball.file(spec, destination, options),
}

let npmOptions: Promise<PacoteOptions> | undefined

async function loadNpmOptions(): Promise<PacoteOptions> {
  npmOptions ??= (async () => {
    const npmMain = fileURLToPath(import.meta.resolve('@npmcli/config'))
    const config = new Config({
      ...npmDefinitions,
      npmPath: resolve(dirname(npmMain), '..'),
      argv: ['node', 'fabric'],
      cwd: process.cwd(),
    })
    await config.load()
    return config.flat
  })()
  return npmOptions
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('Operation aborted', 'AbortError')
}

function localSource(path: string): string {
  return `file:${resolve(path).replaceAll('\\', '/')}`
}

/** Resolve an allowed source to an immutable directory or exact archive candidate. */
export async function resolveFabricPackageSource(
  source: string,
  options: {
    readonly signal?: AbortSignal
    readonly fetcher?: FabricPackageFetcher
  } = {},
): Promise<FabricResolvedPackageSource> {
  const requested = source.trim()
  if (requested === '') throw new Error('Runtime Package source must not be empty')
  const parsed = npa(requested)
  throwIfAborted(options.signal)

  if (parsed.type === 'directory') {
    if (parsed.fetchSpec === undefined) throw new Error(`Runtime Package source "${requested}" has no directory path`)
    return { kind: 'directory', source: localSource(parsed.fetchSpec), directory: resolve(parsed.fetchSpec) }
  }

  const fetcher = options.fetcher ?? defaultFetcher
  if (parsed.type === 'file') {
    if (parsed.fetchSpec === undefined) throw new Error(`Runtime Package source "${requested}" has no archive path`)
    const path = resolve(parsed.fetchSpec)
    const manifest = await fetcher.manifest(path, { signal: options.signal })
    throwIfAborted(options.signal)
    return {
      kind: 'archive',
      source: localSource(path),
      fetchSpec: path,
      expectedName: manifest.name,
      expectedVersion: manifest.version,
      pacoteOptions: { signal: options.signal },
    }
  }

  if (parsed.registry === true && REGISTRY_SOURCE_TYPES.has(parsed.type)) {
    if (parsed.name === undefined) throw new Error(`npm Runtime Package source "${requested}" has no package name`)
    const pacoteOptions = { ...(await loadNpmOptions()), signal: options.signal }
    const manifest = await fetcher.manifest(requested, pacoteOptions)
    throwIfAborted(options.signal)
    if (manifest.name !== parsed.name) {
      throw new Error(`resolved package name "${manifest.name}" does not match requested "${parsed.name}"`)
    }
    const integrity = manifest.dist?.integrity ?? manifest._integrity
    if (typeof integrity !== 'string' || integrity === '') {
      throw new Error(`npm package "${manifest.name}@${manifest.version}" has no registry integrity`)
    }
    return {
      kind: 'archive',
      source: requested,
      fetchSpec: `${manifest.name}@${manifest.version}`,
      expectedName: manifest.name,
      expectedVersion: manifest.version,
      integrity,
      pacoteOptions: { ...pacoteOptions, integrity },
    }
  }

  throw new Error(`Runtime Package source type "${parsed.type}" is not supported`)
}

function validateArchiveEntry(entry: ReadEntry): void {
  const path = entry.path
  if (path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/u.test(path)) {
    throw new Error(`package archive contains invalid path "${path}"`)
  }
  const segments = path.split('/').filter(Boolean)
  if (segments[0] !== 'package' || segments.some(segment => segment === '..')) {
    throw new Error(`package archive entry escapes package root "${path}"`)
  }
  if (!ARCHIVE_ENTRY_TYPES.has(entry.type)) {
    throw new Error(`package archive contains unsupported ${entry.type} entry "${path}"`)
  }
  if (segments.at(-1)?.endsWith('.node') === true) {
    throw new Error(`package archive contains unsupported native addon "${path}"`)
  }
}

/** Download, inspect, and extract one archive without executing package scripts. */
export async function extractFabricPackageArchive(
  resolved: FabricResolvedPackageSource,
  archive: string,
  destination: string,
  options: {
    readonly signal?: AbortSignal
    readonly fetcher?: FabricPackageFetcher
  } = {},
): Promise<void> {
  if (resolved.kind !== 'archive' || resolved.fetchSpec === undefined) throw new Error('resolved source is not an archive')
  const fetcher = options.fetcher ?? defaultFetcher
  throwIfAborted(options.signal)
  await fetcher.tarballFile(resolved.fetchSpec, archive, {
    ...resolved.pacoteOptions,
    ...(resolved.integrity === undefined ? {} : { integrity: resolved.integrity }),
    signal: options.signal,
  })
  throwIfAborted(options.signal)
  let archiveError: unknown
  await list({
    file: archive,
    onReadEntry: entry => {
      if (archiveError !== undefined) return
      try {
        validateArchiveEntry(entry)
      } catch (error) {
        archiveError = error
      }
    },
  })
  if (archiveError !== undefined) throw archiveError
  throwIfAborted(options.signal)
  await extract({ file: archive, cwd: destination, strip: 1, preservePaths: false })
  throwIfAborted(options.signal)
}
