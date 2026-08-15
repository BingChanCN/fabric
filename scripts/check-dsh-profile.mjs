import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const exampleRoot = join(root, 'examples', 'hello-fabric')
const temporary = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
const archivesDir = join(temporary, 'archives')
const dshHome = join(temporary, 'dsh-home')
const windowsDshCli = process.platform === 'win32'
  ? (process.env.PATH ?? '')
      .split(delimiter)
      .map(directory => join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      .find(existsSync)
  : undefined

function fail(message) {
  throw new Error(`profile check: ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    const termination = result.signal === null ? `exit ${String(result.status)}` : `signal ${result.signal}`
    fail(`${command} ${args.join(' ')} failed with ${termination}${output === '' ? '' : `\n${output}`}`)
  }
  return result.stdout
}

function dshInvocation(args) {
  if (process.platform === 'win32') {
    if (windowsDshCli === undefined) fail('could not locate the installed DSH Node entry from PATH')
    return { command: process.execPath, args: [windowsDshCli, ...args] }
  }
  return { command: 'dsh', args }
}

function runDsh(args, environment) {
  const invocation = dshInvocation(args)
  return run(invocation.command, invocation.args, { env: environment })
}

async function archives() {
  return (await readdir(archivesDir)).filter(name => name.endsWith('.tgz')).sort()
}

async function readJson(response, where) {
  if (!response.ok) fail(`${where} returned HTTP ${String(response.status)}: ${await response.text()}`)
  return response.json()
}

async function stopChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    delay(10_000).then(() => false),
  ])
  if (stopped) return
  child.kill('SIGKILL')
  await exited
}

async function smokeWeb(environment) {
  const invocation = dshInvocation(['--profile', 'web', '--host', '127.0.0.1', '--port', '0'])
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let readySettled = false
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readySettled = true
      reject(new Error(`dsh web did not become ready within 90 seconds\n${output}`))
    }, 90_000)
    const inspect = chunk => {
      output += chunk.toString()
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
      if (readySettled || match?.[1] === undefined) return
      readySettled = true
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', error => {
      if (readySettled) return
      readySettled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (readySettled) return
      readySettled = true
      clearTimeout(timer)
      reject(new Error(`dsh web exited before readiness (code=${String(code)}, signal=${String(signal)})\n${output}`))
    })
  })

  try {
    const baseUrl = await ready
    const indexResponse = await fetch(baseUrl, { signal: AbortSignal.timeout(15_000) })
    if (!indexResponse.ok) fail(`web index returned HTTP ${String(indexResponse.status)}`)
    const html = await indexResponse.text()
    const manifestMatch = /window\.__DSH_BOOT__\s*=\s*(\{.*?\})<\/script>/su.exec(html)
    if (manifestMatch?.[1] === undefined) fail('web index has no injected window.__DSH_BOOT__ manifest')
    const manifest = JSON.parse(manifestMatch[1])
    if (!Array.isArray(manifest.entries)) fail('web boot manifest has no entries array')

    for (const id of ['@dsh-do/fabric', 'hello-fabric']) {
      const entry = manifest.entries.find(candidate => candidate?.id === id)
      if (entry === undefined || typeof entry.url !== 'string') fail(`web boot manifest is missing ${id}`)
      const bundleResponse = await fetch(new URL(entry.url, baseUrl), { signal: AbortSignal.timeout(15_000) })
      if (!bundleResponse.ok) fail(`${id} client bundle returned HTTP ${String(bundleResponse.status)}`)
      const bundle = await bundleResponse.text()
      if (!bundle.includes('window.__ModuleLoader__.load')) fail(`${id} client bundle is not a ModuleLoader closure`)
    }

    const resourcePost = async (pluginId, resourceId, operation, body, search = '') => {
      const url = new URL(`/fabric/resource/${encodeURIComponent(pluginId)}/${encodeURIComponent(resourceId)}/${operation}${search}`, baseUrl)
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    }
    const unwrap = (payload, where) => {
      if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
        fail(`${where} missing data envelope: ${JSON.stringify(payload)}`)
      }
      return payload.data
    }
    const schema = { enabled: { type: 'boolean', title: 'Enable example extras', default: false } }
    const initial = unwrap(await readJson(await resourcePost('hello-fabric', 'status', 'query', undefined, '?sessionId=profile-smoke'), 'example status query'), 'example status query')
    if (initial.status !== 'ok' || initial.sessionId !== 'profile-smoke' || initial.enabled !== false) {
      fail(`example status query returned an unexpected payload: ${JSON.stringify(initial)}`)
    }
    const saved = unwrap(await readJson(await resourcePost('hello-fabric', 'settings', 'mutate', { enabled: true }), 'example settings mutate'), 'example settings mutate')
    if (saved.saved !== true || saved.enabled !== true) {
      fail(`example settings mutate returned an unexpected payload: ${JSON.stringify(saved)}`)
    }
    const updated = unwrap(await readJson(await resourcePost('hello-fabric', 'status', 'query', undefined, '?sessionId=profile-smoke'), 'updated example status query'), 'updated example status query')
    if (updated.enabled !== true) fail(`example resource state did not persist: ${JSON.stringify(updated)}`)

    const configId = 'hello-fabric.preferences'
    const initialConfig = unwrap(await readJson(await resourcePost('fabric', 'config', 'query', { operation: 'read', id: configId, schema }), 'fabric config query'), 'fabric config query')
    if (initialConfig.id !== configId || typeof initialConfig.seq !== 'number') {
      fail(`fabric config query returned an unexpected payload: ${JSON.stringify(initialConfig)}`)
    }
    const written = unwrap(await readJson(await resourcePost('fabric', 'config', 'mutate', {
      operation: 'write',
      id: configId,
      seq: initialConfig.seq,
      values: { enabled: true },
      schema,
    }), 'fabric config mutate'), 'fabric config mutate')
    if (written.seq !== initialConfig.seq + 1 || written.values?.enabled !== true) {
      fail(`fabric config mutate returned an unexpected payload: ${JSON.stringify(written)}`)
    }
    const conflict = await resourcePost('fabric', 'config', 'mutate', {
      operation: 'write',
      id: configId,
      seq: initialConfig.seq,
      values: { enabled: false },
      schema,
    })
    if (conflict.status !== 409) fail(`fabric config stale mutate returned HTTP ${String(conflict.status)}`)

    return baseUrl
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    fail(`${reason}${output === '' ? '' : `\ndsh web output:\n${output}`}`)
  } finally {
    await stopChild(child, exited)
  }
}

try {
  await mkdir(archivesDir)
  const pnpmCli = process.env.npm_execpath
  if (pnpmCli === undefined || pnpmCli === '') fail('npm_execpath is unavailable; run this check through pnpm')

  run(process.execPath, [pnpmCli, 'pack', '--pack-destination', archivesDir], { cwd: root })
  const afterFabric = await archives()
  if (afterFabric.length !== 1) fail(`expected one Fabric tarball, found ${afterFabric.length}`)
  const fabricArchive = join(archivesDir, afterFabric[0])

  run(process.execPath, [pnpmCli, 'pack', '--pack-destination', archivesDir], { cwd: exampleRoot })
  const afterExample = await archives()
  if (afterExample.length !== 2) fail(`expected Fabric and example tarballs, found ${afterExample.length}`)
  const exampleName = afterExample.find(name => name !== afterFabric[0])
  if (exampleName === undefined) fail('could not identify the example tarball')
  const exampleArchive = join(archivesDir, exampleName)

  const environment = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH

  runDsh(['plugin', '--profile', 'web', 'add', fabricArchive], environment)
  runDsh(['plugin', '--profile', 'web', 'add', exampleArchive], environment)

  const profilePath = join(dshHome, 'profiles', 'web', 'package.json')
  const profile = JSON.parse(await readFile(profilePath, 'utf8'))
  const bundles = profile.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) fail('profile manifest has no dsh.profile.bundles array')
  const fabricIndex = bundles.indexOf('@dsh-do/fabric')
  const exampleIndex = bundles.indexOf('hello-fabric')
  if (fabricIndex < 0) fail('Fabric tarball was not reconciled as a profile bundle')
  if (exampleIndex < 0) fail('example tarball was not reconciled as a profile bundle')
  if (fabricIndex >= exampleIndex) fail('Fabric must precede the example in the profile bundle order')

  const config = runDsh(['--profile', 'web', '--dump-config'], environment)
  if (!/^- id: fabric\r?\n\s+name: ['"]?@dsh-do\/fabric['"]?\s*$/m.test(config)) {
    fail('assembled profile config is missing the Fabric entry')
  }
  if (!/^- id: fabric-example\r?\n\s+name: ['"]?hello-fabric['"]?\s*$/m.test(config)) {
    fail('assembled profile config is missing the example entry')
  }

  const baseUrl = await smokeWeb(environment)
  console.log(`profile check passed: ${bundles.slice(fabricIndex, exampleIndex + 1).join(' -> ')} (${baseUrl})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
