import { satisfies, valid, validRange } from 'semver'
import { isFabricPackageName } from './identity.ts'

export { isFabricPackageName, runtimeModuleId } from './identity.ts'

export const FABRIC_RUNTIME_FORMAT = 1 as const

export interface FabricRuntimeManifest {
  readonly format: typeof FABRIC_RUNTIME_FORMAT
  readonly api: string
  readonly host?: string
  readonly client?: string
  readonly contracts?: string
}

export interface FabricRuntimePackageManifest {
  readonly name: string
  readonly version: string
  readonly fabric: FabricRuntimeManifest
}

export interface FabricRuntimeManifestValidationOptions {
  readonly expectedName?: string
  readonly expectedVersion?: string
  readonly fabricApiVersion?: string
}

const RELATIVE_ENTRY = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000]+$/u
const INSTALL_LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall'])

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function entry(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || !RELATIVE_ENTRY.test(value) || value.includes('\\')) {
    throw new Error(`${label} must be a relative POSIX path`)
  }
  return value
}

function packageName(value: unknown): string {
  if (typeof value !== 'string' || !isFabricPackageName(value)) throw new Error('package.json name is not a valid npm package name')
  return value
}

/**
 * Validate the package metadata that is allowed to enter the Fabric runtime.
 * This function never reads files or executes package code.
 */
export function validateFabricRuntimePackageManifest(
  value: unknown,
  options: FabricRuntimeManifestValidationOptions = {},
): FabricRuntimePackageManifest {
  const raw = record(value, 'package.json')
  const name = packageName(raw.name)
  const version = typeof raw.version === 'string' && valid(raw.version) !== null
    ? raw.version
    : undefined
  if (version === undefined) throw new Error(`package "${name}" version must be valid semver`)
  if (options.expectedName !== undefined && name !== options.expectedName) {
    throw new Error(`package name "${name}" does not match requested "${options.expectedName}"`)
  }
  if (options.expectedVersion !== undefined && version !== options.expectedVersion) {
    throw new Error(`package version "${version}" does not match requested "${options.expectedVersion}"`)
  }

  if (raw.dsh !== undefined || raw['cordis.patch'] !== undefined || raw['cordis.patch.yml'] !== undefined) {
    throw new Error(`package "${name}" is a legacy DSH plugin, not a Fabric Runtime Package`)
  }
  const rawFabric = record(raw.fabric, `package "${name}" fabric`)
  if (rawFabric.format !== FABRIC_RUNTIME_FORMAT) {
    throw new Error(`package "${name}" uses unsupported Fabric format "${String(rawFabric.format)}"`)
  }
  if (typeof rawFabric.api !== 'string' || rawFabric.api.trim() === '' || validRange(rawFabric.api) === null) {
    throw new Error(`package "${name}" fabric.api must be a valid semver range`)
  }
  if (options.fabricApiVersion !== undefined && !satisfies(options.fabricApiVersion, rawFabric.api)) {
    throw new Error(`package "${name}" requires Fabric API "${rawFabric.api}", current version is "${options.fabricApiVersion}"`)
  }
  const host = rawFabric.host === undefined ? undefined : entry(rawFabric.host, `package "${name}" fabric.host`)
  const client = rawFabric.client === undefined ? undefined : entry(rawFabric.client, `package "${name}" fabric.client`)
  const contracts = rawFabric.contracts === undefined ? undefined : entry(rawFabric.contracts, `package "${name}" fabric.contracts`)
  if (host === undefined && client === undefined) {
    throw new Error(`package "${name}" must provide fabric.host or fabric.client`)
  }

  const scripts = raw.scripts
  if (scripts !== undefined) {
    const scriptRecord = record(scripts, `package "${name}" scripts`)
    for (const script of INSTALL_LIFECYCLE_SCRIPTS) {
      if (scriptRecord[script] !== undefined) {
        throw new Error(`package "${name}" contains unsupported lifecycle script "${script}"`)
      }
    }
  }

  return Object.freeze({
    name,
    version,
    fabric: Object.freeze({
      format: FABRIC_RUNTIME_FORMAT,
      api: rawFabric.api,
      ...(host === undefined ? {} : { host }),
      ...(client === undefined ? {} : { client }),
      ...(contracts === undefined ? {} : { contracts }),
    }),
  })
}

export interface FabricRuntimeBundleValidationOptions {
  readonly moduleId?: string
}

const CLIENT_EXTERNALS = new Set(['@dsh-do/fabric', 'react', 'react/jsx-runtime'])

function moduleSpecifiers(source: string): readonly string[] {
  return [
    ...[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/gu)].map(match => match[1]!),
    ...[...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/gu)].map(match => match[1]!),
  ]
}

export function assertRuntimeBundlePurity(
  kind: 'host' | 'client' | 'contracts',
  source: string,
  options: FabricRuntimeBundleValidationOptions = {},
): void {
  if (source.includes('@deepseek-ai/')) {
    throw new Error(`${kind} runtime bundle contains a private DSH import`)
  }
  const specifiers = moduleSpecifiers(source)
  if (kind === 'contracts') {
    const external = specifiers.find(specifier => specifier !== '@dsh-do/fabric' && !specifier.startsWith('@dsh-do/fabric/'))
    if (external !== undefined) throw new Error(`contracts runtime bundle contains unsupported external "${external}"`)
    if (/\b(?:window|document|navigator)\b/u.test(source)) {
      throw new Error('contracts runtime bundle contains a browser runtime dependency')
    }
    return
  }
  if (kind === 'host') {
    const external = specifiers.find(specifier => !specifier.startsWith('node:'))
    if (external !== undefined) throw new Error(`host runtime bundle contains unsupported external "${external}"`)
    return
  }
  const external = specifiers.find(specifier => !CLIENT_EXTERNALS.has(specifier))
  if (external !== undefined) throw new Error(`client runtime bundle contains unsupported external "${external}"`)
  if (!source.includes('window.__ModuleLoader__.load')) {
    throw new Error('client runtime bundle does not register a ModuleLoader factory')
  }
  if (options.moduleId !== undefined && !source.includes(JSON.stringify(options.moduleId))) {
    throw new Error(`client runtime bundle does not register expected module "${options.moduleId}"`)
  }
}
