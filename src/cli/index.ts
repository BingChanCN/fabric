#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { scaffoldPlugin, parseCreateArgs } from '../create/index.ts'
import { FabricInventoryStore, FabricPackageStore } from '../host/package-store.ts'
import { parseFabricRuntimeDiscovery } from '../runtime/discovery.ts'

const FABRIC_API_VERSION = '1.0.0'

export type FabricCliCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'create'; readonly target: string }
  | { readonly kind: 'build' | 'test' | 'verify' | 'pack'; readonly cwd: string }
  | { readonly kind: 'dev'; readonly cwd: string; readonly profile: string; readonly dshHome: string }

export function parseFabricCliArgs(argv: readonly string[], cwd = process.cwd()): FabricCliCommand {
  const [command, ...rest] = argv
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { kind: 'help' }
  if (command === '--version' || command === '-v' || command === 'version') return { kind: 'version' }
  if (command === 'create') {
    const target = rest.find(value => !value.startsWith('-'))
    if (target === undefined) throw new Error('usage: fabric create <name-or-directory>')
    return { kind: 'create', target }
  }
  if (command === 'build' || command === 'test' || command === 'verify' || command === 'pack') {
    const directoryIndex = rest.findIndex(value => value === '--cwd')
    const directory = directoryIndex < 0 ? cwd : rest[directoryIndex + 1]
    if (directory === undefined || directory.trim() === '') throw new Error('--cwd requires a directory')
    return { kind: command, cwd: resolve(cwd, directory) }
  }
  if (command === 'dev') {
    const valueAfter = (flag: string): string | undefined => {
      const index = rest.indexOf(flag)
      return index < 0 ? undefined : rest[index + 1]
    }
    const directory = valueAfter('--cwd') ?? cwd
    const profile = valueAfter('--profile') ?? 'web'
    const dshHome = valueAfter('--dsh-home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
    if (directory.trim() === '') throw new Error('--cwd requires a directory')
    if (!/^[A-Za-z0-9._-]+$/u.test(profile) || profile === '.' || profile === '..') throw new Error('--profile is invalid')
    return { kind: 'dev', cwd: resolve(cwd, directory), profile, dshHome: resolve(dshHome) }
  }
  throw new Error(`unknown Fabric command "${command}"`)
}

export function formatFabricCliHelp(): string {
  return [
    'Fabric Runtime Package author tools',
    '',
    'Usage:',
    '  fabric create <name-or-directory>',
    '  fabric build [--cwd <directory>]',
    '  fabric test [--cwd <directory>]',
    '  fabric verify [--cwd <directory>]',
    '  fabric pack [--cwd <directory>]',
    '  fabric dev [--profile web] [--cwd <directory>] [--dsh-home <directory>]',
    '  fabric --version',
    '',
  ].join('\n')
}

async function resolveProjectBin(cwd: string, packageName: string, binName: string): Promise<string> {
  const projectRequire = createRequire(join(cwd, 'package.json'))
  const manifestPath = projectRequire.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]
  if (relative === undefined) throw new Error(`${packageName} does not expose the ${binName} executable`)
  return resolve(dirname(manifestPath), relative)
}

async function runProjectBin(cwd: string, packageName: string, binName: string, args: readonly string[]): Promise<void> {
  const bin = await resolveProjectBin(cwd, packageName, binName)
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${binName} failed with exit code ${String(result.status)}`)
}

function runNpmPack(cwd: string): string {
  const invocation = process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm pack --json'] }
    : { command: 'npm', args: ['pack', '--json'] }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`npm pack failed with exit code ${String(result.status)}`)
  }
  if (result.stderr) process.stderr.write(result.stderr)
  return result.stdout
}

async function packageVersion(): Promise<string> {
  for (const relative of ['../package.json', '../../package.json']) {
    try {
      const manifest = JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8')) as { version?: unknown }
      if (typeof manifest.version === 'string') return manifest.version
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error('Fabric package version is unavailable')
}

export async function verifyFabricRuntimeSource(source: string): Promise<{ readonly name: string; readonly version: string }> {
  const profile = await mkdtemp(join(tmpdir(), 'fabric-verify-'))
  try {
    const store = new FabricPackageStore(new FabricInventoryStore(profile))
    const resolved = await store.resolveSource(source)
    const installed = await store.installResolved(resolved, { fabricApiVersion: FABRIC_API_VERSION })
    return { name: installed.manifest.name, version: installed.manifest.version }
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
}

export function parseNpmPackOutput(output: string): unknown {
  const starts = [0]
  for (let index = output.indexOf('\n['); index >= 0; index = output.indexOf('\n[', index + 2)) starts.push(index + 1)
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(output.slice(start).trim()) as unknown
    } catch {
      // Lifecycle scripts may have written non-JSON text before the final npm result.
    }
  }
  throw new Error('npm pack did not return valid JSON')
}

async function pack(cwd: string): Promise<string> {
  await verifyFabricRuntimeSource(cwd)
  const output = runNpmPack(cwd)
  const parsed = parseNpmPackOutput(output)
  if (!Array.isArray(parsed) || typeof (parsed[0] as { filename?: unknown } | undefined)?.filename !== 'string') {
    throw new Error('npm pack did not return a package filename')
  }
  const archive = resolve(cwd, (parsed[0] as { filename: string }).filename)
  try {
    const verified = await verifyFabricRuntimeSource(archive)
    process.stdout.write(`verified ${verified.name}@${verified.version}\n`)
    return archive
  } catch (error) {
    await rm(archive, { force: true })
    throw error
  }
}

interface DevApplyResult {
  readonly packageName: string
  readonly version: string
  readonly generation: number
}

async function devRequest<T>(baseUrl: string, action: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/fabric/dev/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json() as { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `Fabric dev request failed with HTTP ${response.status}`)
  return payload as T
}

async function discoverRuntime(dshHome: string, profile: string): Promise<string> {
  const file = join(dshHome, 'profiles', profile, '.fabric', 'runtime.json')
  let discovery
  try {
    discovery = parseFabricRuntimeDiscovery(JSON.parse(await readFile(file, 'utf8')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Fabric Core is not running for profile "${profile}"`)
    throw error
  }
  try {
    process.kill(discovery.pid, 0)
  } catch {
    throw new Error(`Fabric Core discovery for profile "${profile}" is stale`)
  }
  return discovery.baseUrl
}

async function createDevWatchers(cwd: string, onChange: () => void): Promise<FSWatcher[]> {
  const paths = ['src', 'package.json', 'tsdown.config.ts', 'tsdown.config.js', 'tsconfig.json']
  const watchers: FSWatcher[] = []
  for (const relative of paths) {
    const path = join(cwd, relative)
    if (!existsSync(path)) continue
    const info = await stat(path)
    watchers.push(watch(path, { recursive: info.isDirectory() }, onChange))
  }
  return watchers
}

async function dev(command: Extract<FabricCliCommand, { kind: 'dev' }>): Promise<void> {
  const baseUrl = await discoverRuntime(command.dshHome, command.profile)
  const leaseId = randomUUID()
  let generation = 0
  let active: DevApplyResult | undefined
  let requested = false
  let building = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  let fatal: Error | undefined
  let stopping = false
  let finish!: () => void
  const done = new Promise<void>(resolveDone => { finish = resolveDone })

  const buildAndApply = async (initial: boolean): Promise<void> => {
    if (stopping) return
    try {
      await runProjectBin(command.cwd, 'tsdown', 'tsdown', [])
      if (stopping) return
      generation += 1
      const result = await devRequest<DevApplyResult>(baseUrl, 'apply', {
        leaseId,
        generation,
        source: command.cwd,
      })
      active = result
      process.stdout.write(`dev active ${result.packageName}@${result.version} generation ${result.generation}\n`)
    } catch (error) {
      if (initial) throw error
      process.stderr.write(`dev build retained previous generation: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  const drain = async (): Promise<void> => {
    if (building) return
    building = true
    try {
      while (requested) {
        requested = false
        await buildAndApply(false)
      }
    } finally {
      building = false
    }
  }
  const schedule = (): void => {
    if (debounce !== undefined) clearTimeout(debounce)
    debounce = setTimeout(() => {
      requested = true
      void drain()
    }, 100)
  }

  await buildAndApply(true)
  const watchers = await createDevWatchers(command.cwd, schedule)
  const heartbeat = setInterval(() => {
    if (stopping || active === undefined) return
    void devRequest(baseUrl, 'heartbeat', { leaseId, packageName: active.packageName }).catch(error => {
      fatal = error instanceof Error ? error : new Error(String(error))
      finish()
    })
  }, 2_000)
  const requestStop = (): void => {
    stopping = true
    finish()
  }
  process.once('SIGINT', requestStop)
  process.once('SIGTERM', requestStop)
  process.stdout.write(`watching ${command.cwd}; press Ctrl+C to stop\n`)
  try {
    await done
    while (building) await new Promise(resolve => { setTimeout(resolve, 50) })
  } finally {
    stopping = true
    process.off('SIGINT', requestStop)
    process.off('SIGTERM', requestStop)
    clearInterval(heartbeat)
    if (debounce !== undefined) clearTimeout(debounce)
    for (const watcher of watchers) watcher.close()
    if (active !== undefined) {
      await devRequest(baseUrl, 'stop', { leaseId, packageName: active.packageName }).catch(() => undefined)
    }
  }
  if (fatal !== undefined) throw fatal
}

export async function runFabricCli(command: FabricCliCommand): Promise<void> {
  if (command.kind === 'help') {
    process.stdout.write(formatFabricCliHelp())
    return
  }
  if (command.kind === 'version') {
    process.stdout.write(`${await packageVersion()}\n`)
    return
  }
  if (command.kind === 'create') {
    const options = parseCreateArgs([command.target])
    const written = await scaffoldPlugin(options)
    process.stdout.write(`created ${options.name} in ${options.directory}\n${written.map(file => `  ${file}`).join('\n')}\n`)
    return
  }
  if (command.kind === 'build') {
    await runProjectBin(command.cwd, 'tsdown', 'tsdown', [])
    return
  }
  if (command.kind === 'test') {
    await runProjectBin(command.cwd, 'vitest', 'vitest', ['run'])
    return
  }
  if (command.kind === 'verify') {
    const verified = await verifyFabricRuntimeSource(command.cwd)
    process.stdout.write(`verified ${verified.name}@${verified.version}\n`)
    return
  }
  if (command.kind === 'dev') {
    await dev(command)
    return
  }
  const archive = await pack(command.cwd)
  process.stdout.write(`${basename(archive)}\n`)
}

const invoked = process.argv[1] !== undefined && basename(process.argv[1]).toLowerCase() === 'cli.js'
if (invoked) {
  runFabricCli(parseFabricCliArgs(process.argv.slice(2))).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
