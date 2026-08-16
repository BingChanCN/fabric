import { chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const exampleRoot = join(root, 'examples', 'hello-fabric')
const themeStudioRoot = join(root, '..', 'fabric-theme-studio')
const dshDoRoot = join(root, '..', 'dsh-do')
const temporary = await mkdtemp(join(tmpdir(), 'fabric-browser-profile-'))
const archivesDir = join(temporary, 'archives')
const dshHome = join(temporary, 'dsh-home')
const windowsDshCli = process.platform === 'win32'
  ? (process.env.PATH ?? '').split(delimiter)
      .map(directory => join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      .find(existsSync)
  : undefined

function fail(message) {
  throw new Error(`browser profile check: ${message}`)
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
    fail(`${command} ${args.join(' ')} failed${output === '' ? '' : `\n${output}`}`)
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

async function stopChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  if (await Promise.race([exited.then(() => true), delay(10_000).then(() => false)])) return
  child.kill('SIGKILL')
  await exited
}

async function startDev(environment) {
  const child = spawn(process.execPath, [
    join(root, 'lib', 'cli.js'),
    'dev',
    '--profile', 'web',
    '--cwd', exampleRoot,
    '--dsh-home', dshHome,
  ], {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fabric dev did not become active\n${output}`)), 90_000)
    const inspect = chunk => {
      output += chunk.toString()
      if (!/dev active hello-fabric@1\.0\.0 generation 1/u.test(output)) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code, signal) => reject(new Error(`fabric dev exited before activation (${String(code)}/${String(signal)})\n${output}`)))
  })
  return { child, exited, output: () => output }
}

async function startDsh(environment) {
  const invocation = dshInvocation(['--profile', 'web', '--host', '127.0.0.1', '--port', '0'])
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dsh web did not become ready\n${output}`)), 90_000)
    const inspect = chunk => {
      output += chunk.toString()
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
      if (match?.[1] === undefined) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code, signal) => reject(new Error(`dsh web exited before readiness (${String(code)}/${String(signal)})\n${output}`)))
  })
  return { child, exited, baseUrl, output: () => output }
}

async function makeCandidate(version, hostFailure = false) {
  const directory = join(temporary, `hello-${version}`)
  await mkdir(directory, { recursive: true })
  await cp(join(exampleRoot, 'lib'), join(directory, 'lib'), { recursive: true })
  const manifest = JSON.parse(await readFile(join(exampleRoot, 'package.json'), 'utf8'))
  manifest.version = version
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (hostFailure) {
    await writeFile(join(directory, 'lib', 'fabric-host.js'), `export default { descriptor: { name: 'Broken candidate' }, setup() { throw new Error('candidate setup failed') } }\n`)
  }
  return directory
}

async function openFabric(page) {
  const launcher = page.getByRole('button', { name: /Fabric|打开 Fabric/u }).first()
  await launcher.waitFor({ state: 'visible' })
  const continueButton = page.getByRole('button', { name: /^(继续|Continue)$/u })
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  const laterButton = page.getByRole('button', { name: /稍后配置|Later/u })
  if (await laterButton.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)) await laterButton.click()
  await launcher.click()
  await page.getByRole('heading', { name: /插件|Mods/u }).last().waitFor({ state: 'visible' })
}

async function installFrom(page, source) {
  const input = page.getByRole('textbox', { name: /npm 包规格|npm spec/u })
  await input.fill(`file:${source.replaceAll('\\', '/')}`)
  await page.getByRole('button', { name: /安装|Install/u }).click()
}

async function waitForRuntimeSource(page, expected, label) {
  const matches = source => {
    if (typeof source !== 'string') return false
    if (expected.suffix !== undefined && !source.endsWith(expected.suffix)) return false
    if (expected.notPrefix !== undefined && source.startsWith(expected.notPrefix)) return false
    return true
  }
  const deadline = Date.now() + 30_000
  let stable = 0
  while (Date.now() < deadline) {
    const source = await page.evaluate(async () => {
      const inventory = await fetch('/fabric/runtime/inventory').then(response => response.json())
      return inventory.plugins?.['hello-fabric']?.source
    }).catch(() => undefined)
    if (matches(source)) {
      stable += 1
      if (stable >= 2) return
    } else {
      stable = 0
    }
    await delay(250)
  }
  throw new Error(label)
}

async function waitForOutput(process, pattern, label) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    if (pattern.test(process.output())) return
    if (process.child.exitCode !== null || process.child.signalCode !== null) break
    await delay(100)
  }
  throw new Error(`${label}\n${process.output()}`)
}

async function installThroughDshDo(baseUrl, source) {
  const response = await fetch(`${baseUrl}/api/v1/profiles/web/plugin-operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add', target: `file:${source.replaceAll('\\', '/')}`, runtime: 'fabric' }),
  })
  if (!response.ok) fail(`dsh-do rejected Fabric install (${response.status}): ${await response.text()}`)
  const started = await response.json()
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const operationResponse = await fetch(`${baseUrl}/api/v1/operations/${encodeURIComponent(started.id)}`)
    if (!operationResponse.ok) fail(`dsh-do operation lookup failed (${operationResponse.status})`)
    const operation = await operationResponse.json()
    if (operation.state === 'succeeded') return
    if (operation.state === 'failed') fail(`dsh-do Fabric install failed: ${operation.stderr}`)
    await delay(100)
  }
  fail('dsh-do Fabric install did not finish')
}

try {
  await mkdir(archivesDir)
  const pnpmCli = process.env.npm_execpath
  if (pnpmCli === undefined || pnpmCli === '') fail('npm_execpath is unavailable; run through pnpm')
  run(process.execPath, [pnpmCli, 'run', 'build:example'], { cwd: root })
  run(process.execPath, [pnpmCli, 'run', 'build'], { cwd: themeStudioRoot })
  run(process.execPath, [pnpmCli, 'run', 'build'], { cwd: dshDoRoot })
  run(process.execPath, [pnpmCli, 'pack', '--pack-destination', archivesDir], { cwd: root })
  const archives = (await readdir(archivesDir)).filter(name => name.endsWith('.tgz'))
  if (archives.length !== 1) fail(`expected one Core tarball, found ${archives.length}`)

  const environment = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  runDsh(['plugin', '--profile', 'web', 'add', join(archivesDir, archives[0])], environment)
  const profile = JSON.parse(await readFile(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8'))
  const bundles = profile.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes('@dsh-do/fabric')) fail('Core was not installed as the static profile bundle')
  if (bundles.includes('hello-fabric')) fail('Runtime package leaked into dsh.profile.bundles')

  const v2 = await makeCandidate('1.0.1')
  const broken = await makeCandidate('1.0.2', true)
  let server = await startDsh(environment)
  const { createServer } = await import(pathToFileURL(join(dshDoRoot, 'dist', 'server', 'index.js')).href)
  const dshDo = createServer(dshHome)
  await dshDo.listen({ host: '127.0.0.1', port: 0 })
  const dshDoAddress = dshDo.server.address()
  if (typeof dshDoAddress !== 'object' || dshDoAddress === null) fail('dsh-do did not expose a TCP address')
  const dshDoBaseUrl = `http://127.0.0.1:${dshDoAddress.port}`
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  const page1 = await context.newPage()
  const page2 = await context.newPage()
  for (const page of [page1, page2]) {
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })
  }

  try {
    await Promise.all([page1.goto(server.baseUrl), page2.goto(server.baseUrl)])
    await openFabric(page1)
    const scrimColor = await page1.locator('button').evaluateAll(buttons => {
      const mask = buttons.find(button => {
        const rect = button.getBoundingClientRect()
        return rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1
      })
      return mask === undefined ? '' : getComputedStyle(mask).backgroundColor
    })
    const scrimAlpha = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/u.exec(scrimColor)?.[1]
    if (scrimAlpha === undefined || Number(scrimAlpha) >= 0.8) fail(`Workbench scrim is opaque: ${scrimColor}`)
    await installThroughDshDo(dshDoBaseUrl, exampleRoot)
    await page1.waitForFunction(() => document.body.textContent?.includes('hello-fabric') === true || document.querySelector('p[role="alert"]') !== null)
    const installError = page1.locator('p[role="alert"]')
    if (await installError.isVisible().catch(() => false)) throw new Error(`runtime install failed: ${await installError.textContent()}`)
    await page1.getByText('hello-fabric', { exact: true }).waitFor({ state: 'visible' })

    const productionInventory = JSON.parse(await readFile(join(dshHome, 'profiles', 'web', '.fabric', 'plugins.json'), 'utf8'))
    const productionSource = productionInventory.plugins?.['hello-fabric']?.source
    const dev = await startDev(environment)
    try {
      await waitForRuntimeSource(page1, { suffix: '.1' }, 'dev generation 1 was not published')
      const watchedSource = join(exampleRoot, 'src', 'client', 'index.ts')
      await writeFile(watchedSource, await readFile(watchedSource, 'utf8'))
      await waitForOutput(dev, /generation 2/u, 'fabric dev did not reload generation 2')
      await waitForRuntimeSource(page1, { suffix: '.2' }, 'dev generation 2 was not published')
    } finally {
      await stopChild(dev.child, dev.exited)
    }
    await waitForRuntimeSource(page1, { notPrefix: 'dev:' }, 'production snapshot was not restored after dev')
    const afterDevInventory = JSON.parse(await readFile(join(dshHome, 'profiles', 'web', '.fabric', 'plugins.json'), 'utf8'))
    if (afterDevInventory.plugins?.['hello-fabric']?.source !== productionSource) fail('fabric dev changed production inventory')

    await installFrom(page1, themeStudioRoot)
    await page1.getByText('@dsh-do/fabric-theme-studio', { exact: true }).waitFor({ state: 'visible' })

    await openFabric(page2)
    await page2.getByText('hello-fabric', { exact: true }).waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: 'Hello Fabric', exact: true }).click()
    await page1.getByRole('heading', { name: 'Hello Fabric', exact: true }).last().waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: 'Check Host API' }).click()
    await page1.getByText('Host status: ok').waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: 'Open Demo Dialog' }).click()
    await page1.getByRole('heading', { name: 'Fabric Dialog Service' }).waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: 'Close Dialog', exact: true }).click()
    await page1.getByRole('button', { name: 'Open Non-modal Dialog' }).click()
    await page1.getByRole('heading', { name: 'Non-modal Fabric Dialog' }).waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: 'Dropdown Menu ▾' }).click()
    await page1.getByText('Action 1', { exact: true }).click()
    await page1.getByRole('heading', { name: 'Non-modal Fabric Dialog' }).waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: 'Close Dialog', exact: true }).click()
    await page1.getByRole('button', { name: /插件|Mods/u }).click()
    await page1.getByRole('button', { name: 'Hello Fabric', exact: true }).click()
    await page1.getByText('Host status: ok').waitFor({ state: 'visible' })

    await page1.getByRole('button', { name: /^主题工坊/u }).click()
    await page1.getByRole('heading', { name: '主题工坊 (Theme Gallery)', exact: true }).waitFor({ state: 'visible' })
    const applyTheme = page1.getByRole('button', { name: '应用主题', exact: true }).first()
    if (await applyTheme.isVisible().catch(() => false)) await applyTheme.click()
    await page1.getByText('✓ 当前生效中', { exact: true }).first().waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: '调色盘', exact: true }).click()
    await page1.getByText(/聊天壁纸、材质质感与动态背景/u).waitFor({ state: 'visible' })
    const wallpaperInput = page1.locator('input[type="file"]').nth(1)
    await wallpaperInput.setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    await page1.getByText('壁纸地址', { exact: true }).waitFor({ state: 'visible' })
    await page1.getByRole('button', { name: '全景展台', exact: true }).click()
    await page1.getByRole('heading', { name: '全景展台 (Component Showcase)', exact: true }).waitFor({ state: 'visible' })

    await page1.getByRole('button', { name: /插件|Mods/u }).click()
    const helloRow = page1.getByText('hello-fabric', { exact: true }).locator('..').locator('..')
    await helloRow.getByRole('button', { name: /停用|Disable/u }).click()
    await page1.getByRole('button', { name: 'Hello Fabric', exact: true }).waitFor({ state: 'detached' })
    await page2.getByRole('button', { name: 'Hello Fabric', exact: true }).waitFor({ state: 'detached' })
    const disabledRow = page1.getByText('hello-fabric', { exact: true }).locator('..').locator('..')
    await disabledRow.getByRole('button', { name: /启用|Enable/u }).click()
    await page1.getByRole('button', { name: 'Hello Fabric', exact: true }).waitFor({ state: 'visible' })
    await page2.getByRole('button', { name: 'Hello Fabric', exact: true }).waitFor({ state: 'visible' })

    await installFrom(page1, v2)
    await page1.getByText(/^1\.0\.1 ·/u).waitFor({ state: 'visible' })
    await installFrom(page1, broken)
    await page1.getByText('candidate setup failed').first().waitFor({ state: 'visible' })
    await page1.getByText(/^1\.0\.1 ·/u).waitFor({ state: 'visible' })
    const activeRow = page1.getByText('hello-fabric', { exact: true }).locator('..').locator('..')
    await activeRow.getByRole('button', { name: /回退|Rollback/u }).click()
    await page1.getByText(/1\.0\.0 ·/u).waitFor({ state: 'visible' })

    await Promise.all([page1.close(), page2.close()])
    await stopChild(server.child, server.exited)
    server = await startDsh(environment)
    const restored = await context.newPage()
    restored.on('pageerror', error => pageErrors.push(error.message))
    await restored.goto(server.baseUrl)
    await openFabric(restored)
    await restored.getByText('hello-fabric', { exact: true }).waitFor({ state: 'visible' })
    await restored.getByRole('button', { name: 'Hello Fabric', exact: true }).click()
    await restored.getByRole('heading', { name: 'Hello Fabric', exact: true }).last().waitFor({ state: 'visible' })
    if (pageErrors.length > 0) fail(`browser page errors:\n${pageErrors.join('\n')}`)
  } catch (error) {
    const scratch = join(root, '.scratch')
    await mkdir(scratch, { recursive: true })
    const screenshot = join(scratch, 'browser-profile-failure.png')
    const pages = context.pages()
    if (pages[0] !== undefined) await pages[0].screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
    throw new Error(`${error instanceof Error ? error.message : String(error)}\npage errors:\n${pageErrors.join('\n')}\nscreenshot: ${screenshot}\ndsh output:\n${server.output()}`)
  } finally {
    await browser.close()
    await dshDo.close()
    await stopChild(server.child, server.exited)
  }
  console.log('browser profile check passed: Core boot + dsh-do install + two-tab Runtime update/rollback/restart')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
