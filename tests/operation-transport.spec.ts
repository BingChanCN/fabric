import { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { FabricOperationClient } from '../src/client/operations.ts'
import { fabricOperationRouteHandler } from '../src/host/operations.ts'
import { defineOperation, FabricOperationRegistry } from '../src/operation/contract.ts'
import { defineCodec } from '../src/resource/contract.ts'

const number = defineCodec<number>(value => {
  if (typeof value !== 'number') throw new Error('expected number')
  return value
})
const operation = defineOperation({
  owner: '@example/weather',
  id: 'refresh',
  version: '1',
  input: number,
  result: number,
  progress: number,
})

function request(method: string, url: string, body?: unknown): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  return req
}

function response(): { res: ServerResponse; done: Promise<{ status: number; body: any }> } {
  let status = 200
  const chunks: Buffer[] = []
  let resolve!: (value: { status: number; body: any }) => void
  const done = new Promise<{ status: number; body: any }>(next => { resolve = next })
  const res = new Writable({
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
  }) as unknown as ServerResponse
  res.writeHead = ((code: number) => { status = code; return res }) as ServerResponse['writeHead']
  res.end = ((chunk?: unknown) => {
    if (chunk !== undefined) chunks.push(Buffer.from(String(chunk)))
    const text = Buffer.concat(chunks).toString('utf8')
    resolve({ status, body: text === '' ? undefined : JSON.parse(text) })
    return res
  }) as ServerResponse['end']
  return { res, done }
}

class Source {
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  emit(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }) }
}

describe('Fabric Operation transport', () => {
  it('starts a Host run, retains its result, and reconnects by run id', async () => {
    const registry = new FabricOperationRegistry()
    registry.provide(operation, async (input, run) => {
      run.report(1)
      await Promise.resolve()
      return input * 2
    })
    const route = fabricOperationRouteHandler(registry)
    const started = response()
    await route(request('POST', '/fabric/operation/start/%40example%2Fweather/refresh?version=1', 4), started.res)
    const startBody = await started.done
    expect(startBody.status).toBe(202)
    const runId = startBody.body.run.id as string

    await vi.waitFor(() => expect(registry.getRun(runId)?.getSnapshot().status).toBe('succeeded'))
    const read = response()
    await route(request('GET', `/fabric/operation/runs/${encodeURIComponent(runId)}`), read.res)
    expect(await read.done).toMatchObject({
      status: 200,
      body: { run: { id: runId, status: 'succeeded', result: 8 } },
    })
  })

  it('decodes remote progress/result and does not cancel when the Client handle detaches', async () => {
    const source = new Source()
    const running = {
      id: '@example/weather/refresh/1', owner: '@example/weather', operationId: 'refresh', version: '1',
      status: 'running', progress: 1, result: undefined, error: undefined, revision: 1,
    }
    const fetch = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ run: running }) }))
    const client = new FabricOperationClient({ fetch, createEventSource: () => source })
    const handle = await client.start(operation, 3)
    const listener = vi.fn()
    handle.subscribe(listener)
    source.emit({ ...running, status: 'succeeded', result: 6, revision: 2 })

    await expect(handle.result()).resolves.toBe(6)
    expect(handle.getSnapshot()).toMatchObject({ status: 'succeeded', result: 6 })
    expect(listener).toHaveBeenCalledOnce()
    handle.dispose()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
