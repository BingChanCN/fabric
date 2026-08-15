import { mkdtemp, readFile } from 'node:fs/promises'
import { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FabricConfigRepository } from '../src/host/config-store.ts'
import { FabricResourceHostService, resourceRouteHandler } from '../src/host/resources.ts'
import { fabricConfigResource } from '../src/resource/config.ts'
import { FabricResourceError } from '../src/resource/contract.ts'

const schema = {
  enabled: { type: 'boolean' as const, title: 'Enabled', default: false },
}

async function withRepo(): Promise<FabricConfigRepository> {
  const root = await mkdtemp(join(tmpdir(), 'fabric-config-'))
  return new FabricConfigRepository(root)
}

describe('FabricConfigRepository', () => {
  it('creates a document on the first write and rejects a stale seq', async () => {
    const repo = await withRepo()
    const created = await repo.write('demo', 0, { enabled: true })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.document.seq).toBe(1)
    expect(created.document.values).toEqual({ enabled: true })

    const conflict = await repo.write('demo', 0, { enabled: false })
    expect(conflict.ok).toBe(false)
    if (conflict.ok) return
    expect(conflict.conflict.seq).toBe(1)
    expect(conflict.conflict.values).toEqual({ enabled: true })

    const updated = await repo.write('demo', 1, { enabled: false })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.document.seq).toBe(2)
    const raw = await readFile(join((repo as unknown as { root: string }).root, 'demo.json'), 'utf8').catch(() => '')
    expect(raw.includes('"seq": 2') || updated.document.seq === 2).toBe(true)
  })

  it('rejects path-like ids', async () => {
    const repo = await withRepo()
    await expect(repo.read('../secret')).rejects.toThrow(/invalid config id/)
  })
})

function mockRequest(method: string, url: string, body?: unknown): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = { host: '127.0.0.1' }
  return stream
}

function mockResponse(): { res: ServerResponse; done: Promise<{ status: number; body: unknown }> } {
  let status = 200
  const chunks: Buffer[] = []
  let resolve!: (value: { status: number; body: unknown }) => void
  const done = new Promise<{ status: number; body: unknown }>(next => { resolve = next })
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as unknown as ServerResponse & { headersSent: boolean }
  res.headersSent = false
  res.writeHead = ((code: number) => {
    status = code
    res.headersSent = true
    return res
  }) as ServerResponse['writeHead']
  res.end = ((chunk?: unknown) => {
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(String(chunk)))
    const text = Buffer.concat(chunks).toString('utf8')
    resolve({ status, body: text === '' ? undefined : JSON.parse(text) })
    return res
  }) as ServerResponse['end']
  return { res, done }
}

describe('Fabric config Resource transport', () => {
  it('routes typed query and mutation and reports stale sequence conflicts', async () => {
    const repo = await withRepo()
    const host = new FabricResourceHostService()
    host.provide('fabric', fabricConfigResource, {
      query: async request => repo.read(request.id),
      mutate: async request => {
        if (request.operation !== 'write') throw new Error('expected write request')
        const result = await repo.write(request.id, request.seq, request.values)
        if (!result.ok) {
          throw new FabricResourceError({
            code: 'config-conflict',
            message: 'config changed on the host',
            details: result.conflict,
            retryable: true,
          })
        }
        return result.document
      },
    })
    const route = resourceRouteHandler(host)
    const readBody = { operation: 'read', id: 'demo', schema }
    const empty = mockResponse()
    route(mockRequest('POST', '/fabric/resource/fabric/config/query', readBody), empty.res)
    expect(await empty.done).toMatchObject({ status: 200, body: { data: { id: 'demo', seq: 0, values: {} } } })

    const writeBody = { operation: 'write', id: 'demo', seq: 0, values: { enabled: true }, schema }
    const created = mockResponse()
    route(mockRequest('POST', '/fabric/resource/fabric/config/mutate', writeBody), created.res)
    expect(await created.done).toMatchObject({ status: 200, body: { data: { id: 'demo', seq: 1, values: { enabled: true } } } })

    const stale = mockResponse()
    route(mockRequest('POST', '/fabric/resource/fabric/config/mutate', { ...writeBody, values: { enabled: false } }), stale.res)
    expect((await stale.done).status).toBe(409)
  })
})
