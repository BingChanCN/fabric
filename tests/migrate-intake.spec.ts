import { copyFile, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFabricCliArgs } from '../src/cli/index.ts'
import {
  analyzeFabricPackageIntake,
  formatFabricPackageIntakeAnalysis,
} from '../src/migrate/intake.ts'

const roots: string[] = []

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function write(root: string, relative: string, contents: string): Promise<void> {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents)
}

async function pack(source: string, entries: string[]): Promise<string> {
  const archiveRoot = await temporary('fabric-migrate-intake-archive-')
  const archive = join(archiveRoot, 'package.tgz')
  await create({ cwd: source, file: archive, gzip: true, prefix: 'package/' }, entries)
  return archive
}

async function legacyPackage(options: {
  readonly includeClient?: boolean
  readonly scripts?: unknown
  readonly name?: string
  readonly version?: string
} = {}): Promise<string> {
  const root = await temporary('fabric-migrate-intake-legacy-')
  await write(root, 'package.json', `${JSON.stringify({
    name: options.name ?? '@example/legacy-overlay',
    version: options.version ?? '1.2.3',
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { inject: ['@deepseek-ai/dsh-client-ui-slots'] },
    },
  }, null, 2)}\n`)
  await write(root, 'cordis.patch.yml', `- insert:\n    - id: legacy-overlay\n      name: ${JSON.stringify(options.name ?? '@example/legacy-overlay')}\n`)
  await write(root, 'src/index.ts', 'export const name = "@example/legacy-overlay"\nexport const inject = []\nexport function apply() {}\n')
  if (options.includeClient !== false) {
    await write(root, 'client/index.tsx', `import { StatusHud } from './StatusHud'\n\nexport function apply(ctx: any) {\n  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ id: 'status', name: 'shell.overlay' }, StatusHud))\n}\n`)
    await write(root, 'client/StatusHud.tsx', 'export function StatusHud() { return <div>ready</div> }\n')
  }
  return root
}

async function nativePackage(options: { readonly client?: string } = {}): Promise<string> {
  const root = await temporary('fabric-migrate-intake-native-')
  await write(root, 'package.json', `${JSON.stringify({
    name: '@example/native-weather',
    version: '2.0.0',
    fabric: {
      format: 1,
      api: '^1.0.0',
      host: './lib/fabric-host.js',
      client: './lib/fabric-client.js',
    },
  }, null, 2)}\n`)
  await write(root, 'lib/fabric-host.js', 'export default { descriptor: { name: "Weather" }, setup() {} }\n')
  if (options.client !== undefined) await write(root, 'lib/fabric-client.js', options.client)
  else await write(root, 'lib/fabric-client.js', 'window.__ModuleLoader__.load({ id: "fabric-runtime/%40example%2Fnative-weather" })\n')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('npm package migration intake', () => {
  it('classifies a native archive only after the current Runtime validator admits it', async () => {
    const archive = await pack(await nativePackage(), ['package.json', 'lib'])
    const analysis = await analyzeFabricPackageIntake(`file:${archive}`)

    expect(analysis).toMatchObject({
      status: 'native-compatible',
      packageName: '@example/native-weather',
      version: '2.0.0',
      runtimeManifest: { fabric: { format: 1, client: './lib/fabric-client.js' } },
    })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'native-admission-passed', level: 'info' }))
  })

  it('reports a claimed Runtime package as incompatible when its actual bundle fails admission', async () => {
    const source = await nativePackage({ client: 'window.__ModuleLoader__.load({ id: "wrong" })\n' })
    const analysis = await analyzeFabricPackageIntake(source)

    expect(analysis.status).toBe('native-incompatible')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'native-admission-failed', level: 'blocked' }))
  })

  it('remaps native admission profile failures before exposing remote diagnostics', async () => {
    const source = await nativePackage()
    await rm(join(source, 'lib', 'fabric-client.js'))
    const archive = await pack(source, ['package.json', 'lib'])
    const analysis = await analyzeFabricPackageIntake('npm:@example/native-weather@2.0.0', {
      fetcher: {
        manifest: async () => ({ name: '@example/native-weather', version: '2.0.0', _integrity: 'sha512-test' }),
        tarballFile: async (_spec, destination) => {
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(analysis.status).toBe('native-incompatible')
    const diagnostics = JSON.stringify(analysis.diagnostics)
    expect(diagnostics).not.toContain('fabric-intake-native-')
    expect(diagnostics).toContain('<validation-profile>')
  })

  it('downloads a registry candidate without scripts and analyzes the extracted legacy source', async () => {
    const source = await legacyPackage({ scripts: { preinstall: 'node -e "require(\'node:fs\').writeFileSync(\'executed\', \'yes\')"' } })
    const archive = await pack(source, ['package.json', 'cordis.patch.yml', 'src', 'client'])
    const requested: string[] = []

    const analysis = await analyzeFabricPackageIntake('npm:@example/legacy-overlay@^1', {
      fetcher: {
        manifest: async spec => {
          requested.push(spec)
          return { name: '@example/legacy-overlay', version: '1.2.3', _integrity: 'sha512-test' }
        },
        tarballFile: async (spec, destination) => {
          requested.push(spec)
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(requested).toEqual(['@example/legacy-overlay@^1', '@example/legacy-overlay@1.2.3'])
    expect(analysis).toMatchObject({
      source: 'npm:@example/legacy-overlay@1.2.3',
      status: 'portable',
      packageName: '@example/legacy-overlay',
      version: '1.2.3',
      migration: { status: 'portable', overlay: { id: 'status' } },
    })
    expect(analysis.diagnostics).toEqual([])
    expect(formatFabricPackageIntakeAnalysis(analysis)).toContain('portable mapping shell.overlay#status -> fabric.hud#status')
  })

  it('blocks a registry archive whose package name does not match the resolved identity', async () => {
    const archive = await pack(await legacyPackage({ name: '@example/impostor' }), ['package.json', 'cordis.patch.yml', 'src', 'client'])
    const analysis = await analyzeFabricPackageIntake('npm:@example/legacy-overlay@1.2.3', {
      fetcher: {
        manifest: async () => ({ name: '@example/legacy-overlay', version: '1.2.3', _integrity: 'sha512-test' }),
        tarballFile: async (_spec, destination) => {
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(analysis.status).toBe('blocked')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'resolved-name-mismatch', level: 'blocked' }))
  })

  it('blocks a registry archive whose package version does not match the resolved identity', async () => {
    const archive = await pack(await legacyPackage({ version: '9.9.9' }), ['package.json', 'cordis.patch.yml', 'src', 'client'])
    const analysis = await analyzeFabricPackageIntake('npm:@example/legacy-overlay@1.2.3', {
      fetcher: {
        manifest: async () => ({ name: '@example/legacy-overlay', version: '1.2.3', _integrity: 'sha512-test' }),
        tarballFile: async (_spec, destination) => {
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(analysis.status).toBe('blocked')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'resolved-version-mismatch', level: 'blocked' }))
  })

  it('never loads TypeScript from a downloaded package', async () => {
    const source = await legacyPackage()
    const sentinelRoot = await temporary('fabric-migrate-intake-sentinel-')
    const sentinel = join(sentinelRoot, 'executed')
    await write(source, 'node_modules/typescript/package.json', '{"name":"typescript","main":"index.js"}\n')
    await write(source, 'node_modules/typescript/index.js', `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')\nmodule.exports = {}\n`)
    const archive = await pack(source, ['package.json', 'cordis.patch.yml', 'src', 'client', 'node_modules'])

    const analysis = await analyzeFabricPackageIntake(`file:${archive}`)

    expect(analysis.status).toBe('portable')
    await expect(stat(sentinel)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not downgrade a blocked legacy package to source-missing', async () => {
    const source = await legacyPackage({ includeClient: false })
    await write(source, 'cordis.patch.yml', "- insert:\n    - id: legacy-overlay\n      name: '@example/legacy-overlay'\n    - id: extra\n      name: extra\n")

    const analysis = await analyzeFabricPackageIntake(source)

    expect(analysis.status).toBe('blocked')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'patch-profile-mutation', level: 'blocked' }))
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-entry-missing', level: 'manual' }))
  })

  it('does not leak temporary extraction paths in remote diagnostics', async () => {
    const archive = await pack(await legacyPackage({ includeClient: false }), ['package.json', 'cordis.patch.yml', 'src'])
    const analysis = await analyzeFabricPackageIntake('npm:@example/legacy-overlay@1.2.3', {
      fetcher: {
        manifest: async () => ({ name: '@example/legacy-overlay', version: '1.2.3', _integrity: 'sha512-test' }),
        tarballFile: async (_spec, destination) => {
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(analysis.status).toBe('source-missing')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'client-entry-missing', path: 'npm:@example/legacy-overlay@1.2.3' }))
    expect(JSON.stringify(analysis)).not.toContain('fabric-migrate-intake-')
  })

  it('remaps malformed remote manifest failures to the package source', async () => {
    const source = await temporary('fabric-migrate-intake-invalid-')
    await write(source, 'package.json', '{ not json }\n')
    const archive = await pack(source, ['package.json'])
    const analysis = await analyzeFabricPackageIntake('npm:@example/invalid@1.0.0', {
      fetcher: {
        manifest: async () => ({ name: '@example/invalid', version: '1.0.0', _integrity: 'sha512-test' }),
        tarballFile: async (_spec, destination) => {
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(analysis.status).toBe('blocked')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'package-manifest-invalid',
      path: 'npm:@example/invalid@1.0.0/package.json',
    }))
    expect(JSON.stringify(analysis)).not.toContain('fabric-migrate-intake-')
  })

  it('remaps archive extraction failures to the remote source', async () => {
    let failure: unknown
    try {
      await analyzeFabricPackageIntake('npm:@example/missing-archive@1.0.0', {
        fetcher: {
          manifest: async () => ({ name: '@example/missing-archive', version: '1.0.0', _integrity: 'sha512-test' }),
          tarballFile: async (_spec, destination) => destination,
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toContain('npm:@example/missing-archive@1.0.0')
    expect(message).not.toContain('fabric-migrate-intake-')
  })

  it('does not let npm: disguise local directory or archive sources', async () => {
    const source = await legacyPackage()
    const archive = await pack(source, ['package.json', 'cordis.patch.yml', 'src', 'client'])

    await expect(analyzeFabricPackageIntake(`npm:file:${source}`)).rejects.toThrow('npm migration source must resolve to one registry package version')
    await expect(analyzeFabricPackageIntake(`npm:file:${archive}`)).rejects.toThrow('npm migration source must resolve to one registry package version')
  })

  it('keeps ordinary npm packages out of both native and legacy compatibility labels', async () => {
    const source = await temporary('fabric-migrate-intake-plain-')
    await write(source, 'package.json', '{"name":"ordinary-package","version":"1.0.0"}\n')

    const analysis = await analyzeFabricPackageIntake(source)

    expect(analysis.status).toBe('not-dsh-plugin')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'dsh-manifest-missing', level: 'info' }))
  })

  it('preserves npm and file protocols for analyze while apply remains a local path command', () => {
    expect(parseFabricCliArgs(['migrate', 'analyze', 'npm:@example/weather@^1'], 'D:/workspace')).toEqual({
      kind: 'migrate',
      action: 'analyze',
      source: 'npm:@example/weather@^1',
    })
    expect(parseFabricCliArgs(['migrate', 'analyze', 'file:./weather.tgz'], 'D:/workspace')).toEqual({
      kind: 'migrate',
      action: 'analyze',
      source: 'file:D:\\workspace\\weather.tgz',
    })
    expect(() => parseFabricCliArgs(['migrate', 'apply', 'npm:@example/weather@^1', '--out', 'runtime'], 'D:/workspace')).toThrow('fabric migrate apply only accepts a local source directory')
  })
})
