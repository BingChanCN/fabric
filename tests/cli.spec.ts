import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatFabricCliHelp, parseFabricCliArgs, parseNpmPackOutput, verifyFabricRuntimeSource } from '../src/cli/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Fabric author CLI', () => {
  it('parses author commands relative to the requested working directory', () => {
    expect(parseFabricCliArgs(['create', '@example/weather'], 'D:/work')).toEqual({
      kind: 'create',
      target: '@example/weather',
    })
    expect(parseFabricCliArgs(['verify', '--cwd', 'plugin'], 'D:/work')).toEqual({
      kind: 'verify',
      cwd: resolve('D:/work', 'plugin'),
    })
    expect(parseFabricCliArgs(['dev', '--profile', 'sandbox', '--cwd', 'plugin', '--dsh-home', 'D:/dsh'], 'D:/work')).toEqual({
      kind: 'dev',
      cwd: resolve('D:/work', 'plugin'),
      profile: 'sandbox',
      dshHome: resolve('D:/dsh'),
    })
    expect(formatFabricCliHelp()).toContain('fabric dev')
    expect(parseNpmPackOutput('build output\n[{"filename":"plugin.tgz"}]\n')).toEqual([{ filename: 'plugin.tgz' }])
  })

  it('uses the runtime package admission path to verify a built directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fabric-cli-package-'))
    roots.push(root)
    await mkdir(join(root, 'lib'))
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: '@example/weather',
      version: '1.0.0',
      fabric: { format: 1, api: '^1.0.0', host: './lib/fabric-host.js' },
    }))
    await writeFile(join(root, 'lib', 'fabric-host.js'), 'export default { descriptor: { name: "Weather" }, setup() {} }')

    await expect(verifyFabricRuntimeSource(root)).resolves.toEqual({ name: '@example/weather', version: '1.0.0' })
  })
})
