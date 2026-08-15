import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'fabric-create-check-'))

function fail(message) {
  throw new Error(`create check: ${message}`)
}

try {
  const cli = join(root, 'lib/create.js')
  try {
    await access(cli)
  } catch {
    fail('lib/create.js is missing; run the Fabric build first')
  }

  const target = join(temporary, 'demo-mod')
  const result = spawnSync(process.execPath, [cli, target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    fail(`create-fabric-plugin failed\n${[result.stdout, result.stderr].filter(Boolean).join('\n')}`)
  }

  const client = await readFile(join(target, 'src/client/index.ts'), 'utf8')
  if (!client.includes('defineClientPlugin')) fail('scaffolded client does not use defineClientPlugin')
  if (client.includes('ClientContext') || client.includes('ctx.fabric.register')) {
    fail('scaffolded client still depends on the deleted 0.4 public API')
  }
  const host = await readFile(join(target, 'src/index.ts'), 'utf8')
  if (!host.includes('defineHostPlugin') || !host.includes('mountHostPlugin')) {
    fail('scaffolded host does not use defineHostPlugin')
  }
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  if (manifest.name !== 'demo-mod') fail(`unexpected scaffold name ${manifest.name}`)
  if (!manifest.dsh?.client?.inject?.includes('@dsh-do/fabric')) fail('scaffold dsh.client.inject is missing @dsh-do/fabric')
  if (manifest.peerDependencies?.['@dsh-do/fabric'] !== '^0.5.0') {
    fail('scaffold peerDependencies does not reference @dsh-do/fabric ^0.5.0')
  }
  const tsdownConfig = await readFile(join(target, 'tsdown.config.ts'), 'utf8')
  if (!tsdownConfig.includes("from '@dsh-do/fabric/build'")) {
    fail('scaffold tsdown.config.ts does not import the @dsh-do/fabric build preset')
  }
  console.log('create check passed: demo-mod')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
