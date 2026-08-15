import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`types check: ${label} failed with exit ${String(result.status)}${output === '' ? '' : `\n${output}`}`)
  }
}

const tsc = process.execPath
const cli = fileURLToPath(new URL('../node_modules/typescript/lib/tsc.js', import.meta.url))

// 1. The hand-written declarations must be internally consistent.
run(tsc, [cli, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM,DOM.Iterable', '--jsx', 'react-jsx', '--skipLibCheck', 'true',
  'types/index.d.ts', 'types/client.d.ts', 'types/host.d.ts', 'types/sdk.d.ts', 'types/ui.d.ts', 'types/build.d.ts', 'types/create.d.ts'], 'declaration self-consistency')

// 2. The probe compiles representative public API usage against the declarations.
run(tsc, [cli, '-p', 'tests/types-probe/tsconfig.json'], 'public API probe')

console.log('types check passed: declarations are self-consistent and the public API probe compiles')
