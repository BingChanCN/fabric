import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCreateArgs, renderScaffold, scaffoldPlugin } from '../src/create/index.ts'

describe('create-fabric-plugin', () => {
  it('derives a valid plugin name from the target directory', () => {
    expect(parseCreateArgs(['./tmp/my-plugin']).name).toBe('my-plugin')
    expect(() => parseCreateArgs(['123bad'])).toThrow(/invalid/)
    expect(() => parseCreateArgs([])).toThrow(/usage/)
  })

  it('writes a client entry that waits for fabric', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fabric-create-'))
    const written = await scaffoldPlugin({ directory, name: 'demo-mod' })
    expect(written).toContain('src/client/index.ts')
    const client = await readFile(join(directory, 'src/client/index.ts'), 'utf8')
    expect(client).toContain("export const inject = ['fabric'] as const")
    expect(client).toContain("kind: 'page'")
    expect(renderScaffold('demo-mod')['package.json']).toContain('"fabric": "^0.4.0"')
  })
})
