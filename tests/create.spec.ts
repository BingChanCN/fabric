import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCreateArgs, renderScaffold, scaffoldPlugin } from '../src/create/index.ts'

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

  it('writes a generated-bootstrap client that never mentions DSH types', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fabric-create-'))
    const written = await scaffoldPlugin({ directory, name: 'demo-mod' })
    expect(written).toContain('src/client/index.ts')
    const client = await readFile(join(directory, 'src/client/index.ts'), 'utf8')
    expect(client).toContain('defineClientPlugin')
    expect(client).toContain('ctx.pages.define')
    expect(client).not.toContain('ClientContext')
    expect(client).not.toContain("export const inject")
    expect(client).not.toContain('ctx.fabric.register')
    const host = await readFile(join(directory, 'src/index.ts'), 'utf8')
    expect(host).toContain('defineHostPlugin')
    expect(host).toContain('mountHostPlugin')
    const manifest = renderScaffold('demo-mod')['package.json'] ?? ''
    expect(manifest).toContain('"@dsh-do/fabric": "^0.6.0"')
    expect(manifest).toContain('"inject": [\n        "@dsh-do/fabric"\n      ]')
  })
})
