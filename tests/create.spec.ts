import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCreateArgs, renderScaffold, scaffoldPlugin } from '../src/create/index.ts'
import { validateFabricRuntimePackageManifest } from '../src/runtime/manifest.ts'

describe('create-fabric-plugin', () => {
  it('derives a valid plugin name from the target directory', () => {
    expect(parseCreateArgs(['./tmp/my-plugin']).name).toBe('my-plugin')
    expect(parseCreateArgs(['@dsh-do/theme-kit'])).toEqual({
      directory: expect.stringMatching(/theme-kit$/u),
      name: '@dsh-do/theme-kit',
    })
    expect(() => parseCreateArgs(['123bad'])).toThrow(/invalid/)
    expect(() => parseCreateArgs([])).toThrow(/usage/)
  })

  it('writes a Runtime Package without a DSH bundle or static mount', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fabric-create-'))
    const written = await scaffoldPlugin({ directory, name: 'demo-mod' })
    expect(written).toContain('src/client/index.tsx')
    expect(written).not.toContain('cordis.patch.yml')
    const client = await readFile(join(directory, 'src/client/index.tsx'), 'utf8')
    expect(client).toContain('defineClientPlugin')
    expect(client).toContain('ctx.pages.define')
    expect(client).not.toContain('ClientContext')
    expect(client).not.toContain('ctx.fabric.register')
    const host = await readFile(join(directory, 'src/host.ts'), 'utf8')
    expect(host).toContain("from '@dsh-do/fabric/host'")
    expect(host).toContain('export default defineHostPlugin')
    expect(host).not.toContain('mountHostPlugin')
    const manifest = JSON.parse(renderScaffold('demo-mod')['package.json'] ?? '') as unknown
    expect(validateFabricRuntimePackageManifest(manifest, { fabricApiVersion: '1.0.0' })).toMatchObject({
      name: 'demo-mod',
      version: '0.1.0',
      fabric: { format: 1, api: '^1.0.0', host: './lib/fabric-host.js', client: './lib/fabric-client.js' },
    })
  })
})
