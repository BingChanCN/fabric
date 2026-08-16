import { mkdtemp } from 'node:fs/promises'
import { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FabricBlobService, fabricBlobRouteHandler } from '../src/host/blobs.ts'
import { FabricInventoryStore } from '../src/host/package-store.ts'

function request(url: string): IncomingMessage {
  const req = Readable.from([]) as IncomingMessage
  req.method = 'GET'
  req.url = url
  req.headers = { host: 'localhost' }
  return req
}

function response(): { res: ServerResponse; done: Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }> } {
  let status = 200
  let headers: Record<string, unknown> = {}
  const chunks: Buffer[] = []
  let resolve!: (value: { status: number; body: Buffer; headers: Record<string, unknown> }) => void
  const done = new Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }>(next => { resolve = next })
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = ((code: number, values?: Record<string, unknown>) => {
    status = code
    headers = values ?? {}
    return res
  }) as ServerResponse['writeHead']
  res.end = ((chunk?: unknown) => {
    if (chunk !== undefined) chunks.push(Buffer.from(chunk as Uint8Array))
    resolve({ status, body: Buffer.concat(chunks), headers })
    return res
  }) as ServerResponse['end']
  return { res, done }
}

describe('FabricBlobService', () => {
  it('atomically stores opaque package-owned blobs and serves only enabled owners', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'fabric-blobs-'))
    const service = new FabricBlobService(profile)
    const weather = service.forOwner('@example/weather')
    const ref = await weather.put({ contentType: 'image/png', body: Uint8Array.from([1, 2, 3]) })
    expect(ref).toMatchObject({ owner: '@example/weather', contentType: 'image/png', size: 3 })
    expect(await weather.read(ref)).toMatchObject({ ...ref, body: Uint8Array.from([1, 2, 3]) })
    expect(weather.url(ref)).toBe(`/fabric/blob/%40example%2Fweather/${ref.id}`)
    expect(() => service.forOwner('@example/other').read(ref)).toThrow(/another package/)

    const inventory = new FabricInventoryStore(profile)
    const route = fabricBlobRouteHandler(service, inventory)
    const disabled = response()
    await route(request(weather.url(ref)), disabled.res)
    expect((await disabled.done).status).toBe(404)

    await inventory.update(() => ({
      '@example/weather': { version: '1.0.0', source: 'file:/weather', enabled: true },
    }))
    const enabled = response()
    await route(request(weather.url(ref)), enabled.res)
    expect(await enabled.done).toMatchObject({
      status: 200,
      body: Buffer.from([1, 2, 3]),
      headers: { 'content-type': 'image/png', 'content-length': 3 },
    })

    await weather.delete(ref)
    await expect(weather.read(ref)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
