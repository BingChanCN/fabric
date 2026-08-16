import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { defineDocument, FabricDocumentConflictError } from '../src/document/contract.ts'
import { FabricDocumentService, fabricPackageDataPath } from '../src/host/documents.ts'
import { defineCodec } from '../src/resource/contract.ts'

const stateCodec = defineCodec<{ count: number }>(value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('state must be an object')
  const count = (value as Record<string, unknown>).count
  if (typeof count !== 'number' || !Number.isSafeInteger(count)) throw new Error('count must be an integer')
  return { count }
})

const stateDocument = defineDocument({
  id: 'state',
  version: '1',
  codec: stateCodec,
  initial: { count: 0 },
})

async function profile(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fabric-documents-'))
}

describe('FabricDocumentService', () => {
  it('persists codec-validated values with revision conflicts and serialized updates', async () => {
    const root = await profile()
    const service = new FabricDocumentService(root)
    const handle = await service.open('@example/weather', stateDocument)
    expect(await handle.read()).toEqual({ value: { count: 0 }, revision: 0 })

    const listener = vi.fn()
    const unsubscribe = handle.subscribe(listener)
    expect(await handle.replace({ count: 1 }, 0)).toEqual({ value: { count: 1 }, revision: 1 })
    const conflict = await handle.replace({ count: 2 }, 0).catch(error => error as unknown)
    expect(conflict).toBeInstanceOf(FabricDocumentConflictError)
    expect(conflict).toMatchObject({
      code: 'document-conflict',
      current: { value: { count: 1 }, revision: 1 },
    })
    await Promise.all(Array.from({ length: 5 }, () => handle.update(value => ({ count: value.count + 1 }))))
    expect(await handle.read()).toEqual({ value: { count: 6 }, revision: 6 })
    expect(listener).toHaveBeenCalledTimes(6)

    unsubscribe()
    handle.close()
    expect(() => handle.read()).toThrow(/closed/)

    const reopened = await service.open('@example/weather', stateDocument)
    expect(await reopened.read()).toEqual({ value: { count: 6 }, revision: 6 })
    reopened.close()
  })

  it('isolates package namespaces and fails fast on a stored version mismatch', async () => {
    const root = await profile()
    const service = new FabricDocumentService(root)
    const left = await service.open('@alice/weather', stateDocument)
    const right = await service.open('@bob/weather', stateDocument)
    await left.replace({ count: 7 })
    expect(await right.read()).toEqual({ value: { count: 0 }, revision: 0 })
    left.close()
    right.close()

    const file = join(fabricPackageDataPath(root, '@alice/weather'), 'documents', 'state.json')
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...stored, version: '2' }), 'utf8')
    await expect(service.open('@alice/weather', stateDocument)).rejects.toThrow(/stored version is "2"/)
  })
})
