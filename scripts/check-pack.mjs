import { spawnSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'fabric-pack-'))
const unpacked = join(temporary, 'unpacked')

function fail(message) {
  throw new Error(`pack check: ${message}`)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
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

async function requireFile(packageRoot, relativePath) {
  try {
    await access(join(packageRoot, relativePath))
  } catch {
    fail(`tarball is missing ${relativePath}`)
  }
}

function exportTargets(entry) {
  if (typeof entry === 'string') return [entry]
  if (entry === null || typeof entry !== 'object') fail('contains an invalid export entry')
  return Object.values(entry).filter(value => typeof value === 'string')
}

try {
  const pnpmCli = process.env.npm_execpath
  if (pnpmCli === undefined || pnpmCli === '') fail('npm_execpath is unavailable; run this check through pnpm')
  run(process.execPath, [pnpmCli, 'pack', '--json', '--pack-destination', temporary])

  const archives = (await readdir(temporary)).filter(name => name.endsWith('.tgz'))
  if (archives.length !== 1) fail(`expected one tarball, found ${archives.length}`)
  await mkdir(unpacked)
  const archive = join(temporary, archives[0])
  const tarPath = path => process.platform === 'win32' ? path.replaceAll('\\', '/') : path
  // GNU tar needs --force-local for drive-letter paths; Windows' bundled
  // bsdtar (libarchive) rejects that option entirely.
  const tarProbe = spawnSync('tar', ['--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const isGnuTar = /GNU tar/iu.test(tarProbe.stdout ?? '')
  const tarArgs = isGnuTar
    ? ['--force-local', '-xzf', tarPath(archive), '-C', tarPath(unpacked)]
    : ['-xzf', tarPath(archive), '-C', tarPath(unpacked)]
  run('tar', tarArgs)

  const packageRoot = join(unpacked, 'package')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== '@dsh-do/fabric') fail(`unexpected package name ${JSON.stringify(manifest.name)}`)
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch must point to ./cordis.patch.yml')
  if (manifest.dsh?.client?.platform !== 'web') fail('dsh.client.platform must be web')
  if (manifest.dsh?.client?.immediately !== true) {
    fail('dsh.client.immediately must be true so downstream require("@dsh-do/fabric") can see the factory')
  }

  const requiredFiles = [
    'README.md',
    'LICENSE',
    'cordis.patch.yml',
    'docs/index.md',
    'docs/architecture.md',
    'docs/plugin-development.md',
    'docs/components.md',
    'docs/configuration.md',
    'docs/theming.md',
    'docs/commands-and-capabilities.md',
    'docs/cli.md',
    'docs/api-reference.md',
    'lib/index.js',
    'lib/client.js',
    'lib/sdk.js',
    'lib/ui.js',
    'lib/build.js',
    'lib/create.js',
    'types/index.d.ts',
    'types/client.d.ts',
    'types/host.d.ts',
    'types/sdk.d.ts',
    'types/ui.d.ts',
    'types/build.d.ts',
    'types/create.d.ts',
  ]
  await Promise.all(requiredFiles.map(path => requireFile(packageRoot, path)))

  const expectedExports = ['.', './client', './sdk', './ui', './build', './create', './package.json']
  if (manifest.bin?.['create-fabric-plugin'] !== './lib/create.js') {
    fail('bin.create-fabric-plugin must point to ./lib/create.js')
  }
  for (const key of expectedExports) {
    const entry = manifest.exports?.[key]
    if (entry === undefined) fail(`missing export ${key}`)
    for (const target of exportTargets(entry)) {
      if (!target.startsWith('./')) fail(`export ${key} has non-relative target ${target}`)
      await requireFile(packageRoot, target.slice(2))
    }
  }

  const expectedClientInjections = [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ]
  const injections = manifest.dsh?.client?.inject
  if (!Array.isArray(injections)) fail('dsh.client.inject must be an array')
  for (const dependency of expectedClientInjections) {
    if (!injections.includes(dependency)) fail(`dsh.client.inject is missing ${dependency}`)
  }

  const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
  if (!/^\s*-\s+insert:/m.test(patch) || !/^\s+name:\s+['"]?@dsh-do\/fabric['"]?\s*$/m.test(patch)) {
    fail('cordis.patch.yml does not insert fabric')
  }
  if (/^\s+name:\s+['"]?(?:root|app\.root)['"]?\s*$/m.test(patch)) {
    fail('cordis.patch.yml must not register a root plugin row')
  }

  const client = await readFile(join(packageRoot, 'lib/client.js'), 'utf8')
  if (!client.startsWith('window.__ModuleLoader__.load(')) fail('lib/client.js is not a prebuilt DSH ModuleLoader bundle')
  if (!/\bid:\s*["']@dsh-do\/fabric["']/.test(client)) fail('lib/client.js registers the wrong module id')
  if (/require\(["']@dsh-do\/fabric(?:\/client|\/ui|\/sdk)?["']\)/.test(client)) {
    fail('lib/client.js imports a second Fabric runtime')
  }

  const clientTypes = await readFile(join(packageRoot, 'types/client.d.ts'), 'utf8')
  if (!clientTypes.includes('defineClientPlugin')) fail('types/client.d.ts does not expose defineClientPlugin')
  if (!clientTypes.includes('FabricClientPluginContext')) fail('types/client.d.ts is missing FabricClientPluginContext')
  if (clientTypes.includes('registerConfig') || clientTypes.includes("kind: 'mod'")) {
    fail('types/client.d.ts still exposes the deleted 0.4 contribution API')
  }

  const build = await readFile(join(packageRoot, 'lib/build.js'), 'utf8')
  if (!build.includes('fabric-runtime-import-boundary') || !build.includes('@dsh-do/fabric/')) {
    fail('lib/build.js does not rewrite Fabric subpaths onto the singleton ABI')
  }

  console.log(`pack check passed: ${manifest.name}@${manifest.version} (${archives[0]})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
