import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = join(root, 'lib', 'cli.js')
const temp = await mkdtemp(join(tmpdir(), 'fabric-migrate-check-'))
const source = join(temp, 'legacy')
const output = join(temp, 'runtime')

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) throw new Error(`fabric ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

try {
  await mkdir(join(source, 'src'), { recursive: true })
  await mkdir(join(source, 'client'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: '@example/legacy-overlay-check',
    version: '1.2.3',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inject: ['slots'] } },
  }, null, 2))
  await writeFile(join(source, 'cordis.patch.yml'), "- insert:\n    - id: example.legacy-overlay-check\n      name: '@example/legacy-overlay-check'\n")
  await writeFile(join(source, 'src', 'index.ts'), "export const name = '@example/legacy-overlay-check'\nexport const inject = []\nexport function apply() {}\n")
  await writeFile(join(source, 'client', 'index.tsx'), "import { StatusHud as Hud } from './StatusHud.tsx'\n\nexport function apply(ctx) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay', order: 20 }, Hud))\n}\n")
  await writeFile(join(source, 'client', 'StatusHud.tsx'), "import styles from './StatusHud.module.css'\n\nfunction label(value) { return String(value) }\n\nexport function StatusHud() {\n  return <div className={styles.status}>{label('Migrated status')}</div>\n}\n")
  await writeFile(join(source, 'client', 'StatusHud.module.css'), '.status { color: #b42318; }\n')

  run(['migrate', 'analyze', source])
  run(['migrate', 'apply', source, '--out', output])
  const link = join(output, 'node_modules', '@dsh-do', 'fabric')
  const tsdown = join(output, 'node_modules', 'tsdown')
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  await mkdir(dirname(link), { recursive: true })
  await symlink(root, link, linkType)
  await symlink(join(root, 'node_modules', 'tsdown'), tsdown, linkType)
  run(['build', '--cwd', output])
  run(['verify', '--cwd', output])
} finally {
  await rm(temp, { recursive: true, force: true })
}
