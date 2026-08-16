import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFabricCliArgs } from '../src/cli/index.ts'
import {
  analyzeLegacyDshPlugin,
  applyLegacyDshPluginMigration,
  formatFabricMigrationAnalysis,
} from '../src/migrate/index.ts'
import { validateFabricRuntimePackageManifest } from '../src/runtime/manifest.ts'

const roots: string[] = []

async function write(root: string, relative: string, contents: string): Promise<void> {
  const path = join(root, relative)
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, contents)
}

async function createLegacyOverlay(options: {
  readonly host?: string
  readonly component?: string
  readonly patch?: string
} = {}): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.scratch', 'fabric-migrate-'))
  roots.push(root)
  await write(root, 'package.json', `${JSON.stringify({
    name: '@example/legacy-overlay',
    version: '1.2.3',
    description: 'Legacy status HUD',
    license: 'MIT',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { inject: ['@deepseek-ai/dsh-client-ui-slots'] },
    },
    dependencies: { react: '^18.3.1' },
  }, null, 2)}\n`)
  await write(root, 'cordis.patch.yml', options.patch ?? `- insert:\n    - id: legacy-overlay\n      name: '@example/legacy-overlay'\n`)
  await write(root, 'src/index.ts', options.host ?? `export const name = '@example/legacy-overlay'\nexport const inject = []\nexport function apply() {}\n`)
  await write(root, 'client/index.tsx', `import { StatusHud } from './StatusHud.tsx'\n\nexport function apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({\n    id: 'status',\n    name: 'shell.overlay',\n    order: 20,\n  }, StatusHud))\n}\n`)
  await write(root, 'client/StatusHud.tsx', options.component ?? `import styles from './StatusHud.module.css'\n\nfunction label(value) {\n  return String(value)\n}\n\nexport function StatusHud() {\n  return <div className={styles.status}>{label('ready')}</div>\n}\n`)
  await write(root, 'client/StatusHud.module.css', '.status { color: red; }\n')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('legacy DSH source migration', () => {
  it('analyzes and generates an isolated Runtime HUD package for the portable subset', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay()
    const analysis = await analyzeLegacyDshPlugin(source)

    expect(analysis).toMatchObject({
      packageName: '@example/legacy-overlay',
      version: '1.2.3',
      status: 'portable',
      diagnostics: [],
      overlay: { id: 'status', order: 20, component: 'StatusHud' },
    })
    expect(formatFabricMigrationAnalysis(analysis)).toContain('shell.overlay#status -> fabric.hud#status')

    const output = join(dirname(source), `${basename(source)}-runtime-overlay`)
    roots.push(output)
    const result = await applyLegacyDshPluginMigration(source, output)
    expect(result).toMatchObject({ directory: output, packageName: '@example/legacy-overlay', version: '1.2.3' })
    expect(result.copiedFiles).toEqual(['client/StatusHud.module.css', 'client/StatusHud.tsx'])

    const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).not.toHaveProperty('dsh')
    expect(manifest).toMatchObject({
      fabric: { format: 1, api: '^1.0.0', client: './lib/fabric-client.js' },
    })
    expect(validateFabricRuntimePackageManifest(manifest, { fabricApiVersion: '1.0.0' })).toMatchObject({ name: '@example/legacy-overlay', version: '1.2.3' })
    expect(await readFile(join(output, 'tsdown.config.ts'), 'utf8')).toContain("clientEntry: 'src/client/index.tsx'")
    expect(JSON.parse(await readFile(join(output, 'tsconfig.json'), 'utf8'))).toMatchObject({ compilerOptions: { strict: false } })
    const generatedClient = await readFile(join(output, 'src/client/index.tsx'), 'utf8')
    expect(generatedClient).toContain('../legacy/client/StatusHud')
    expect(generatedClient).not.toContain('../legacy/client/StatusHud.tsx')
    expect(generatedClient).toContain("ctx.hud.define")
    expect(await readFile(join(output, 'src/legacy/client/StatusHud.tsx'), 'utf8')).toContain('StatusHud')
    expect(await readFile(join(output, 'src/legacy/client/StatusHud.module.css'), 'utf8')).toContain('color: red')
    expect(await readFile(join(source, 'client/index.tsx'), 'utf8')).toContain('ctx.slots.inject')

    await expect(applyLegacyDshPluginMigration(source, output)).rejects.toThrow('migration output already exists')
  })

  it('reports Host behavior as manual work without generating output', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay({ host: `export function apply(ctx: any) {\n  ctx.tools('legacy')\n}\n` })
    const analysis = await analyzeLegacyDshPlugin(source)

    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'host-behavior-unsupported', level: 'manual' }))
    await expect(applyLegacyDshPluginMigration(source, join(dirname(source), `${basename(source)}-runtime-host`))).rejects.toThrow('host-behavior-unsupported')
  })

  it('preserves aliased local component imports in the generated Runtime client', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay()
    await write(source, 'client/index.tsx', `import { StatusHud as Hud } from './StatusHud'\n\nexport function apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay' }, Hud))\n}\n`)
    const output = join(dirname(source), `${basename(source)}-runtime-alias`)
    roots.push(output)
    expect((await analyzeLegacyDshPlugin(source)).status).toBe('portable')
    await applyLegacyDshPluginMigration(source, output)
    expect(await readFile(join(output, 'src/client/index.tsx'), 'utf8')).toContain('import { StatusHud as Hud }')
  })

  it('blocks private DSH imports in copied Client dependencies', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay({ component: `import { Slots } from '@deepseek-ai/dsh-client-ui-slots'\n\nexport function StatusHud() {\n  return <div>{String(Slots)}</div>\n}\n` })
    const analysis = await analyzeLegacyDshPlugin(source)

    expect(analysis.status).toBe('blocked')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-private-dsh-import', level: 'blocked', path: join(source, 'client/StatusHud.tsx') }))
  })

  it('blocks a Cordis patch that does more than insert this package', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay({ patch: `- insert:\n    - id: legacy-overlay\n      name: '@example/legacy-overlay'\n- delete: legacy-row\n` })
    const analysis = await analyzeLegacyDshPlugin(source)

    expect(analysis.status).toBe('blocked')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'patch-profile-mutation', level: 'blocked' }))
  })

  it('rejects Host imports and computed registration metadata', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const imported = await createLegacyOverlay({ host: `import './register'\n\nexport const name = '@example/legacy-overlay'\nexport const inject = []\nexport function apply() {}\n` })
    let analysis = await analyzeLegacyDshPlugin(imported)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'host-behavior-unsupported', level: 'manual' }))

    const computed = await createLegacyOverlay({ host: `function nameForRuntime() { return '@example/legacy-overlay' }\nexport const name = nameForRuntime()\nexport const inject = []\nexport function apply() {}\n` })
    analysis = await analyzeLegacyDshPlugin(computed)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'host-behavior-unsupported', level: 'manual' }))

    const javascript = await createLegacyOverlay()
    const legacyManifest = JSON.parse(await readFile(join(javascript, 'package.json'), 'utf8')) as Record<string, unknown>
    await write(javascript, 'package.json', `${JSON.stringify({ ...legacyManifest, main: 'lib/index.js' }, null, 2)}\n`)
    await rm(join(javascript, 'src', 'index.ts'))
    await write(javascript, 'src/index.js', "export function apply(ctx) { ctx.tools('legacy') }\n")
    analysis = await analyzeLegacyDshPlugin(javascript)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'host-language-unsupported', level: 'manual' }))

    const unknown = await createLegacyOverlay()
    const unknownManifest = JSON.parse(await readFile(join(unknown, 'package.json'), 'utf8')) as Record<string, unknown>
    await write(unknown, 'package.json', `${JSON.stringify({ ...unknownManifest, main: '../outside.js' }, null, 2)}\n`)
    analysis = await analyzeLegacyDshPlugin(unknown)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'host-entry-missing', level: 'manual' }))

    const parameterEffect = await createLegacyOverlay({ host: `function registerLegacyHook() { return {} }\nexport function apply(_ctx: unknown, config = registerLegacyHook()) {}\n` })
    analysis = await analyzeLegacyDshPlugin(parameterEffect)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'host-behavior-unsupported', level: 'manual' }))
  })

  it('requires a named exported Client apply function', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay()
    await write(source, 'client/index.tsx', `import { StatusHud } from './StatusHud'\n\nfunction apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay' }, StatusHud))\n}\n`)
    const analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-apply-unsupported', level: 'manual' }))
  })

  it('rejects Client entry behavior that would not be copied into the Runtime package', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay()
    await write(source, 'client/index.tsx', `import { StatusHud } from './StatusHud'\nimport './legacy-registration'\n\nexport function apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay' }, StatusHud))\n}\n`)
    await write(source, 'client/legacy-registration.ts', 'globalThis.legacyRegistration = true\n')
    const analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-entry-top-level-unsupported', level: 'manual' }))
  })

  it('allows a no-op arrow Host apply while rejecting dynamic module loading', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay({ host: 'export const apply = () => {}\n' })
    expect((await analyzeLegacyDshPlugin(source)).status).toBe('portable')

    await write(source, 'client/StatusHud.tsx', `export function StatusHud() {\n  void import('./late')\n  return <div>ready</div>\n}\n`)
    await write(source, 'client/late.ts', 'export const late = true\n')
    const analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-runtime-module-load-unsupported', level: 'manual' }))
  })

  it('requires manual migration for unsupported client source languages and assets', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay()
    await write(source, 'client/index.tsx', `import { StatusHud } from './StatusHud.jsx'\n\nexport function apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay' }, StatusHud))\n}\n`)
    await write(source, 'client/StatusHud.jsx', 'export function StatusHud() { return <div>ready</div> }\n')
    let analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-overlay-component-language-unsupported', level: 'manual' }))

    await write(source, 'client/index.tsx', `import { StatusHud } from './StatusHud.tsx'\n\nexport function apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay' }, StatusHud))\n}\n`)
    await write(source, 'client/StatusHud.module.css', ".status { background: url('./badge.svg'); }\n")
    await write(source, 'client/badge.svg', '<svg/>\n')
    analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-style-asset-unsupported', level: 'manual' }))

    await write(source, 'client/StatusHud.module.css', ".status { composes: base from './base.module.css'; }\n")
    await write(source, 'client/base.module.css', '.base { color: red; }\n')
    analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-style-composes-unsupported', level: 'manual' }))

    await write(source, 'client/StatusHud.module.css', '.status { color: red; }\n')
    await write(source, 'client/StatusHud.tsx', `import badge from './badge.svg'\n\nexport function StatusHud() {\n  return <div>{String(badge)}</div>\n}\n`)
    analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-local-asset-unsupported', level: 'manual' }))

    await write(source, 'client/StatusHud.tsx', `import './StatusHud.scss'\n\nexport function StatusHud() {\n  return <div>ready</div>\n}\n`)
    await write(source, 'client/StatusHud.scss', '.status { color: red; }\n')
    analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-style-unsupported', level: 'manual' }))
  })

  it('requires manual migration for legacy declarations and CommonJS imports', async () => {
    await mkdir(join(process.cwd(), '.scratch'), { recursive: true })
    const source = await createLegacyOverlay()
    await write(source, 'src/global.d.ts', 'declare const legacyRuntimeValue: string\n')
    let analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-declaration-unsupported', level: 'manual', path: join(source, 'src', 'global.d.ts') }))

    await rm(join(source, 'src', 'global.d.ts'))
    await write(source, 'client/StatusHud.tsx', `import LegacyValue = require('./LegacyValue')\n\nexport function StatusHud() {\n  return <div>{String(LegacyValue)}</div>\n}\n`)
    await write(source, 'client/LegacyValue.ts', 'const LegacyValue = "ready"\nexport = LegacyValue\n')
    analysis = await analyzeLegacyDshPlugin(source)
    expect(analysis.status).toBe('manual')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-import-equals-unsupported', level: 'manual' }))
    await expect(applyLegacyDshPluginMigration(source, `${source}-runtime`)).rejects.toThrow('cannot apply Fabric migration')
  })

  it('parses the explicit migration commands without overloading build flags', () => {
    expect(parseFabricCliArgs(['migrate', 'analyze', 'legacy'], 'D:/workspace')).toEqual({
      kind: 'migrate',
      action: 'analyze',
      source: resolve('D:/workspace', 'legacy'),
    })
    expect(parseFabricCliArgs(['migrate', 'apply', 'legacy', '--out', 'runtime'], 'D:/workspace')).toEqual({
      kind: 'migrate',
      action: 'apply',
      source: resolve('D:/workspace', 'legacy'),
      output: resolve('D:/workspace', 'runtime'),
    })
    expect(() => parseFabricCliArgs(['migrate', 'apply', 'legacy'], 'D:/workspace')).toThrow('usage: fabric migrate')
  })
})
