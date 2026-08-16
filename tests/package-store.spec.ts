import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import pacote from 'pacote'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FabricInventoryStore, FabricPackageStore, LocalFabricPackageManager,
} from '../src/host/package-store.ts'
import type { FabricPackageFetcher } from '../src/host/package-source.ts'

const profiles: string[] = []

async function makePackage(version: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fabric-runtime-package-'))
  profiles.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@example/weather',
    version,
    fabric: {
      format: 1,
      api: '^0.8.0',
      host: './lib/fabric-host.js',
      client: './lib/fabric-client.js',
    },
  }))
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'lib', 'fabric-host.js'), 'export default { descriptor: { name: "Weather" }, setup() {} }')
  await writeFile(join(root, 'lib', 'fabric-client.js'), 'window.__ModuleLoader__.load({ id: "fabric-runtime/%40example%2Fweather" })')
  return root
}

async function packPackage(source: string): Promise<string> {
  const archiveRoot = await mkdtemp(join(tmpdir(), 'fabric-runtime-archive-'))
  profiles.push(archiveRoot)
  const archive = join(archiveRoot, 'package.tgz')
  await create({ cwd: source, file: archive, gzip: true, prefix: 'package/' }, ['package.json', 'lib'])
  return archive
}

afterEach(async () => {
  await Promise.all(profiles.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Fabric local Runtime Package store', () => {
  it('installs an immutable directory snapshot and persists desired state', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const source = await makePackage('1.0.0')
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')

    const installed = await manager.install(source)
    expect(installed).toEqual({
      name: '@example/weather',
      entry: {
        version: '1.0.0',
        source: `file:${source.replaceAll('\\', '/')}`,
        enabled: true,
      },
    })
    const entry = installed.entry
    const snapshot = await manager.inventory()
    expect(snapshot.revision).toBe(1)
    expect(snapshot.plugins['@example/weather']).toEqual(entry)
    await expect(stat(inventory.packagePath('@example/weather', '1.0.0'))).resolves.toBeTruthy()
    expect(JSON.parse(await readFile(inventory.pluginsFile, 'utf8'))).toMatchObject({
      format: 1,
      revision: 1,
    })
  })

  it('keeps enable/disable mutations serialized in the desired-state file', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const source = await makePackage('1.0.0')
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    await manager.install(source)

    await manager.disable('@example/weather')
    expect((await manager.inventory()).plugins['@example/weather']?.enabled).toBe(false)
    await manager.enable('@example/weather')
    expect((await manager.inventory()).plugins['@example/weather']?.enabled).toBe(true)
    await expect(manager.disable('@example/missing')).rejects.toThrow('not installed')
  })

  it('retains current and previous successful versions and rolls back without reinstalling', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const first = await makePackage('1.0.0')
    const second = await makePackage('2.0.0')
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    await manager.install(first)

    const upgraded = await manager.install(second)
    expect(upgraded.entry).toMatchObject({
      version: '2.0.0',
      previous: { version: '1.0.0' },
    })
    const rolledBack = await manager.rollback('@example/weather')
    expect(rolledBack).toMatchObject({
      version: '1.0.0',
      previous: { version: '2.0.0' },
    })
    await expect(stat(inventory.packagePath('@example/weather', '1.0.0'))).resolves.toBeTruthy()
    await expect(stat(inventory.packagePath('@example/weather', '2.0.0'))).resolves.toBeTruthy()
  })

  it('can reinstall the previous version without deleting the new current directory', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const first = await makePackage('1.0.0')
    const second = await makePackage('2.0.0')
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    await manager.install(first)
    await manager.install(second)

    const switched = await manager.install(first)

    expect(switched.entry).toMatchObject({ version: '1.0.0', previous: { version: '2.0.0' } })
    await expect(stat(inventory.packagePath('@example/weather', '1.0.0'))).resolves.toBeTruthy()
    await expect(stat(inventory.packagePath('@example/weather', '2.0.0'))).resolves.toBeTruthy()
  })

  it('rejects the same immutable version from a different source', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const first = await makePackage('1.0.0')
    const conflicting = await makePackage('1.0.0')
    await writeFile(join(conflicting, 'lib', 'fabric-host.js'), 'export default { setup() { throw new Error("other") } }')
    const inventory = new FabricInventoryStore(profile)
    const store = new FabricPackageStore(inventory)
    const manager = new LocalFabricPackageManager(store, '0.8.2')
    const installed = await manager.install(first)

    await expect(manager.install(conflicting)).rejects.toThrow(/different source/)

    expect((await manager.inventory()).plugins['@example/weather']).toEqual(installed.entry)
    expect(await readFile(join(inventory.packagePath('@example/weather', '1.0.0'), 'lib', 'fabric-host.js'), 'utf8')).not.toContain('other')
  })

  it('removes current and previous code only after removing its desired-state entry', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const first = await makePackage('1.0.0')
    const second = await makePackage('2.0.0')
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    await manager.install(first)
    await manager.install(second)
    const dataFile = join(inventory.dataPath('@example/weather'), 'documents', 'state.json')
    await mkdir(join(inventory.dataPath('@example/weather'), 'documents'), { recursive: true })
    await writeFile(dataFile, '{}')

    await manager.remove('@example/weather')
    expect((await manager.inventory()).plugins['@example/weather']).toBeUndefined()
    await expect(stat(inventory.packagePath('@example/weather', '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(inventory.packagePath('@example/weather', '2.0.0'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(dataFile)).resolves.toBeTruthy()

    await manager.purge('@example/weather')
    await expect(stat(inventory.dataPath('@example/weather'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('installs a real file:tgz through archive validation', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const archive = await packPackage(await makePackage('1.2.0'))
    const manager = new LocalFabricPackageManager(new FabricPackageStore(new FabricInventoryStore(profile)), '0.8.2')

    const installed = await manager.install(`file:${archive}`)

    expect(installed.entry).toMatchObject({ version: '1.2.0', source: `file:${archive.replaceAll('\\', '/')}` })
  })

  it('resolves an npm range to one exact archive while retaining the requested update source', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const archive = await packPackage(await makePackage('1.3.0'))
    const requested: string[] = []
    const manager = new LocalFabricPackageManager(new FabricPackageStore(new FabricInventoryStore(profile)), '0.8.2')

    const installed = await manager.install('@example/weather@^1', {
      fetcher: {
        manifest: async spec => {
          requested.push(spec)
          return { name: '@example/weather', version: '1.3.0', _integrity: 'sha512-test' }
        },
        tarballFile: async (spec, destination) => {
          requested.push(spec)
          await copyFile(archive, destination)
          return destination
        },
      },
    })

    expect(requested).toEqual(['@example/weather@^1', '@example/weather@1.3.0'])
    expect(installed.entry).toMatchObject({ version: '1.3.0', source: '@example/weather@^1' })
  })

  it('passes registry integrity to the tarball fetch and leaves no candidate on mismatch', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const source = await makePackage('1.0.0')
    const archive = await packPackage(source)
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    const fetcher: FabricPackageFetcher = {
      manifest: async () => ({
        name: '@example/weather',
        version: '1.0.0',
        dist: {
          tarball: 'https://registry.example.invalid/weather.tgz',
          integrity: `sha512-${'A'.repeat(88)}`,
        },
      }),
      tarballFile: (_spec, destination, options) => pacote.tarball.file(archive, destination, options),
    }

    await expect(manager.install('@example/weather@1', { fetcher })).rejects.toThrow(/integrity|checksum/i)
    expect((await manager.inventory()).plugins).toEqual({})
    expect(await readdir(inventory.packagesRoot)).toEqual([])
  })

  it('rejects native archive content without changing desired state', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const source = await makePackage('1.0.0')
    await writeFile(join(source, 'lib', 'binding.node'), 'not native code')
    const archiveRoot = await mkdtemp(join(tmpdir(), 'fabric-runtime-archive-'))
    profiles.push(archiveRoot)
    const archive = join(archiveRoot, 'package.tgz')
    await create({ cwd: source, file: archive, gzip: true, prefix: 'package/' }, ['package.json', 'lib'])
    const manager = new LocalFabricPackageManager(new FabricPackageStore(new FabricInventoryStore(profile)), '0.8.2')

    await expect(manager.install(`file:${archive}`)).rejects.toThrow(/native addon/)
    expect((await manager.inventory()).plugins).toEqual({})
  })

  it('cleans staging and immutable versions not referenced by current or previous', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const source = await makePackage('1.0.0')
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    await manager.install(source)
    const orphan = inventory.packagePath('@example/weather', '9.0.0')
    const staleStaging = inventory.stagingPath('stale')
    await mkdir(orphan, { recursive: true })
    await mkdir(staleStaging, { recursive: true })

    await inventory.cleanStaging()
    await inventory.cleanOrphanedVersions()

    await expect(stat(inventory.packagePath('@example/weather', '1.0.0'))).resolves.toBeTruthy()
    await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(staleStaging)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects path-like package names before purge can leave its namespace', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')
    const sentinel = join(inventory.root, 'data', 'sentinel')
    await mkdir(sentinel, { recursive: true })
    await writeFile(join(sentinel, 'keep'), 'yes')

    await expect(manager.purge('.')).rejects.toThrow(/invalid/)
    await expect(manager.purge('..')).rejects.toThrow(/invalid/)
    await expect(readFile(join(sentinel, 'keep'), 'utf8')).resolves.toBe('yes')
  })

  it('rejects a package that does not match the installed Fabric API before committing it', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-profile-'))
    profiles.push(profile)
    const source = await makePackage('1.0.0')
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: '@example/weather', version: '1.0.0',
      fabric: { format: 1, api: '^0.9.0', client: './lib/fabric-client.js' },
    }))
    const inventory = new FabricInventoryStore(profile)
    const manager = new LocalFabricPackageManager(new FabricPackageStore(inventory), '0.8.2')

    await expect(manager.install(source)).rejects.toThrow(/requires Fabric API/)
    expect((await manager.inventory()).plugins).toEqual({})
  })
})
