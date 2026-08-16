import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import {
  FabricInventoryStore, FabricPackageStore,
} from '../host/package-store.ts'
import {
  extractFabricPackageArchive, resolveFabricPackageSource,
  type FabricPackageFetcher, type FabricResolvedPackageSource,
} from '../host/package-source.ts'
import type { FabricRuntimePackageManifest } from '../runtime/manifest.ts'
import {
  analyzeLegacyDshPlugin,
  type FabricMigrationAnalysis,
  type FabricMigrationDiagnostic,
} from './index.ts'

const FABRIC_API_VERSION = '1.0.0'

export type FabricPackageIntakeStatus =
  | 'native-compatible'
  | 'native-incompatible'
  | 'portable'
  | 'manual'
  | 'blocked'
  | 'source-missing'
  | 'not-dsh-plugin'

export type FabricPackageIntakeDiagnosticLevel = 'info' | 'manual' | 'blocked'

export interface FabricPackageIntakeDiagnostic {
  readonly level: FabricPackageIntakeDiagnosticLevel
  readonly code: string
  readonly message: string
  readonly path: string
  readonly line: number
  readonly column: number
}

export interface FabricPackageIntakeAnalysis {
  readonly source: string
  readonly packageName?: string
  readonly version?: string
  readonly status: FabricPackageIntakeStatus
  readonly diagnostics: readonly FabricPackageIntakeDiagnostic[]
  readonly runtimeManifest?: FabricRuntimePackageManifest
  readonly migration?: FabricMigrationAnalysis
}

export interface FabricPackageIntakeOptions {
  readonly fetcher?: FabricPackageFetcher
  readonly fabricApiVersion?: string
}

interface PackageMetadata {
  readonly raw: Readonly<Record<string, unknown>>
  readonly packageName?: string
  readonly version?: string
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function diagnostic(
  level: FabricPackageIntakeDiagnosticLevel,
  code: string,
  message: string,
  path: string,
): FabricPackageIntakeDiagnostic {
  return Object.freeze({ level, code, message, path, line: 1, column: 1 })
}

function isProtocolSource(source: string): boolean {
  return source.startsWith('npm:') || source.startsWith('file:')
}

function sourceForResolution(source: string): string {
  if (!source.startsWith('npm:')) return source
  const spec = source.slice('npm:'.length).trim()
  if (spec === '') throw new Error('npm migration source must name a package')
  return spec
}

function sourceLabel(requested: string, resolved: FabricResolvedPackageSource): string {
  if (requested.startsWith('npm:')) {
    if (resolved.expectedName !== undefined && resolved.expectedVersion !== undefined) {
      return `npm:${resolved.expectedName}@${resolved.expectedVersion}`
    }
    return requested
  }
  return resolved.source
}

function displayPath(root: string, source: string, path: string): string {
  const item = relative(root, path)
  if (item === '') return source
  if (item === '..' || item.startsWith(`..${sep}`)) return path
  return `${source}/${item.split(sep).join('/')}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function remapErrorMessage(root: string, source: string, value: string): string {
  const windowsRoot = root.replaceAll('/', '\\')
  const posixRoot = root.replaceAll('\\', '/')
  return value.replaceAll(root, source).replaceAll(windowsRoot, source).replaceAll(posixRoot, source)
}

function remapMigration(
  analysis: FabricMigrationAnalysis,
  root: string,
  source: string,
): FabricMigrationAnalysis {
  return Object.freeze({
    ...analysis,
    source,
    diagnostics: Object.freeze(analysis.diagnostics.map(item => Object.freeze({
      ...item,
      path: displayPath(root, source, item.path),
    }))),
    ...(analysis.clientEntry === undefined ? {} : { clientEntry: displayPath(root, source, analysis.clientEntry) }),
  })
}

function remapDiagnostics(diagnostics: readonly FabricMigrationDiagnostic[]): readonly FabricPackageIntakeDiagnostic[] {
  return Object.freeze(diagnostics.map(item => Object.freeze({ ...item })))
}

async function packageMetadata(directory: string): Promise<PackageMetadata> {
  const path = join(directory, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const raw = record(parsed)
  if (raw === undefined) throw new Error(`${path} must contain a JSON object`)
  return Object.freeze({
    raw,
    ...(typeof raw.name === 'string' && raw.name.trim() !== '' ? { packageName: raw.name } : {}),
    ...(typeof raw.version === 'string' && raw.version.trim() !== '' ? { version: raw.version } : {}),
  })
}

async function validateNativeDirectory(
  directory: string,
  resolved: FabricResolvedPackageSource | undefined,
  fabricApiVersion: string,
): Promise<FabricRuntimePackageManifest> {
  const profile = await mkdtemp(join(tmpdir(), 'fabric-intake-native-'))
  try {
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const installed = await store.installDirectory(directory, { fabricApiVersion })
    if (resolved?.expectedName !== undefined && installed.manifest.name !== resolved.expectedName) {
      throw new Error(`package name "${installed.manifest.name}" does not match resolved "${resolved.expectedName}"`)
    }
    if (resolved?.expectedVersion !== undefined && installed.manifest.version !== resolved.expectedVersion) {
      throw new Error(`package version "${installed.manifest.version}" does not match resolved "${resolved.expectedVersion}"`)
    }
    return installed.manifest
  } catch (error) {
    throw new Error(remapErrorMessage(profile, '<validation-profile>', errorMessage(error)))
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
}

function resolvedIdentityDiagnostic(
  metadata: PackageMetadata,
  resolved: FabricResolvedPackageSource | undefined,
  source: string,
): FabricPackageIntakeDiagnostic | undefined {
  if (resolved?.expectedName !== undefined && metadata.packageName !== resolved.expectedName) {
    return diagnostic('blocked', 'resolved-name-mismatch', `Package name "${metadata.packageName ?? 'missing'}" does not match resolved "${resolved.expectedName}"`, `${source}/package.json`)
  }
  if (resolved?.expectedVersion !== undefined && metadata.version !== resolved.expectedVersion) {
    return diagnostic('blocked', 'resolved-version-mismatch', `Package version "${metadata.version ?? 'missing'}" does not match resolved "${resolved.expectedVersion}"`, `${source}/package.json`)
  }
  return undefined
}

function sourceMissing(analysis: FabricMigrationAnalysis): boolean {
  return analysis.diagnostics.some(item => item.code === 'client-entry-missing')
}

async function analyzeDirectory(
  directory: string,
  source: string,
  resolved: FabricResolvedPackageSource | undefined,
  options: FabricPackageIntakeOptions,
): Promise<FabricPackageIntakeAnalysis> {
  let metadata: PackageMetadata
  try {
    metadata = await packageMetadata(directory)
  } catch (error) {
    return Object.freeze({
      source,
      status: 'blocked',
      diagnostics: Object.freeze([
        diagnostic('blocked', 'package-manifest-invalid', remapErrorMessage(directory, source, errorMessage(error)), `${source}/package.json`),
      ]),
    })
  }

  const prefix = {
    source,
    ...(metadata.packageName === undefined ? {} : { packageName: metadata.packageName }),
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
  }
  const identityMismatch = resolvedIdentityDiagnostic(metadata, resolved, source)
  if (identityMismatch !== undefined) {
    return Object.freeze({
      ...prefix,
      status: 'blocked',
      diagnostics: Object.freeze([identityMismatch]),
    })
  }
  if (metadata.raw.fabric !== undefined) {
    try {
      const runtimeManifest = await validateNativeDirectory(directory, resolved, options.fabricApiVersion ?? FABRIC_API_VERSION)
      return Object.freeze({
        ...prefix,
        packageName: runtimeManifest.name,
        version: runtimeManifest.version,
        status: 'native-compatible',
        diagnostics: Object.freeze([
          diagnostic('info', 'native-admission-passed', 'Runtime package passed the current Fabric static admission validator', `${source}/package.json`),
        ]),
        runtimeManifest,
      })
    } catch (error) {
      return Object.freeze({
        ...prefix,
        status: 'native-incompatible',
        diagnostics: Object.freeze([
          diagnostic('blocked', 'native-admission-failed', remapErrorMessage(directory, source, errorMessage(error)), `${source}/package.json`),
        ]),
      })
    }
  }

  if (metadata.raw.dsh === undefined) {
    return Object.freeze({
      ...prefix,
      status: 'not-dsh-plugin',
      diagnostics: Object.freeze([
        diagnostic('info', 'dsh-manifest-missing', 'Package declares neither a Fabric Runtime manifest nor a legacy DSH manifest', `${source}/package.json`),
      ]),
    })
  }

  try {
    const migration = remapMigration(await analyzeLegacyDshPlugin(directory, {
      useSourceTypeScript: resolved?.kind !== 'archive',
    }), directory, source)
    return Object.freeze({
      ...prefix,
      packageName: migration.packageName,
      version: migration.version,
      status: migration.status === 'blocked' ? 'blocked' : sourceMissing(migration) ? 'source-missing' : migration.status,
      diagnostics: remapDiagnostics(migration.diagnostics),
      migration,
    })
  } catch (error) {
    return Object.freeze({
      ...prefix,
      status: 'blocked',
      diagnostics: Object.freeze([
        diagnostic('blocked', 'legacy-analysis-failed', remapErrorMessage(directory, source, errorMessage(error)), `${source}/package.json`),
      ]),
    })
  }
}

async function withIntakeDirectory<T>(
  input: string,
  options: FabricPackageIntakeOptions,
  visit: (directory: string, source: string, resolved?: FabricResolvedPackageSource) => Promise<T>,
): Promise<T> {
  if (!isProtocolSource(input)) return visit(resolve(input), resolve(input))

  const requestedSource = sourceForResolution(input)
  const resolved = await resolveFabricPackageSource(requestedSource, {
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  })
  if (input.startsWith('npm:') && (
    resolved.provenance !== 'registry' || resolved.kind !== 'archive' || resolved.expectedName === undefined || resolved.expectedVersion === undefined
  )) {
    throw new Error('npm migration source must resolve to one registry package version')
  }
  const source = sourceLabel(input, resolved)
  if (resolved.kind === 'directory') {
    if (resolved.directory === undefined) throw new Error('resolved migration source has no directory')
    return visit(resolved.directory, source, resolved)
  }

  const root = await mkdtemp(join(tmpdir(), 'fabric-migrate-intake-'))
  const directory = join(root, 'package')
  try {
    await mkdir(directory)
    try {
      await extractFabricPackageArchive(resolved, join(root, 'package.tgz'), directory, {
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      })
    } catch (error) {
      throw new Error(remapErrorMessage(root, source, errorMessage(error)))
    }
    return await visit(directory, source, resolved)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * Inspect a local legacy source directory, a local npm archive, or an npm registry package
 * without executing package scripts or installing its dependencies.
 */
export async function analyzeFabricPackageIntake(
  input: string,
  options: FabricPackageIntakeOptions = {},
): Promise<FabricPackageIntakeAnalysis> {
  const source = input.trim()
  if (source === '') throw new Error('migration source must not be empty')
  return withIntakeDirectory(source, options, (directory, label, resolved) => analyzeDirectory(directory, label, resolved, options))
}

export function formatFabricPackageIntakeAnalysis(analysis: FabricPackageIntakeAnalysis): string {
  const identity = analysis.packageName === undefined || analysis.version === undefined
    ? 'unknown package'
    : `${analysis.packageName}@${analysis.version}`
  const lines = [`${analysis.status} ${identity}`, `source ${analysis.source}`]
  if (analysis.migration?.overlay !== undefined) {
    lines.push(`portable mapping shell.overlay#${analysis.migration.overlay.id} -> fabric.hud#${analysis.migration.overlay.id}`)
  }
  for (const item of analysis.diagnostics) {
    lines.push(`${item.level} ${item.code} ${item.path}:${item.line}:${item.column} ${item.message}`)
  }
  return `${lines.join('\n')}\n`
}
