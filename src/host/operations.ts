import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  FABRIC_OPERATION_PREFIX,
  type FabricOperationRegistry, type FabricOperationSnapshot, type FabricOperationWireSnapshot,
} from '../operation/contract.ts'

const MAX_INPUT_BYTES = 1024 * 1024

function wireSnapshot(snapshot: FabricOperationSnapshot<unknown, unknown>): FabricOperationWireSnapshot {
  return {
    ...snapshot,
    error: snapshot.error === undefined ? undefined : {
      name: snapshot.error.name,
      message: snapshot.error.message,
    },
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    size += chunk.byteLength
    if (size > MAX_INPUT_BYTES) throw new Error('operation input exceeds 1 MiB')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/** Generic Host transport for start, reconnect, cancel, and progress observation. */
export function fabricOperationRouteHandler(registry: FabricOperationRegistry) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? FABRIC_OPERATION_PREFIX, 'http://localhost')
    const relative = url.pathname.startsWith(`${FABRIC_OPERATION_PREFIX}/`)
      ? url.pathname.slice(FABRIC_OPERATION_PREFIX.length + 1)
      : ''
    const parts = relative.split('/')
    if (parts[0] === 'start' && parts.length === 3 && req.method === 'POST') {
      const owner = decode(parts[1]!)
      const id = decode(parts[2]!)
      const version = url.searchParams.get('version')
      if (owner === undefined || id === undefined || version === null || version === '') {
        json(res, 400, { error: { code: 'operation-request-invalid', message: 'operation identity is invalid' } })
        return
      }
      try {
        const run = registry.startByIdentity(owner, id, version, await readBody(req))
        json(res, 202, { run: wireSnapshot(run.getSnapshot()) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        json(res, message.includes('is unavailable') ? 404 : 400, {
          error: { code: message.includes('is unavailable') ? 'operation-unavailable' : 'operation-input-invalid', message },
        })
      }
      return
    }

    if (parts[0] !== 'runs' || parts.length < 2 || parts.length > 3) {
      json(res, 404, { error: { code: 'operation-route-not-found', message: 'operation route not found' } })
      return
    }
    const runId = decode(parts[1]!)
    const run = runId === undefined ? undefined : registry.getRun(runId)
    if (run === undefined) {
      json(res, 404, { error: { code: 'operation-run-not-found', message: 'operation run not found' } })
      return
    }
    if (parts.length === 2 && req.method === 'GET') {
      json(res, 200, { run: wireSnapshot(run.getSnapshot()) })
      return
    }
    if (parts[2] === 'cancel' && req.method === 'POST') {
      run.cancel()
      json(res, 202, { run: wireSnapshot(run.getSnapshot()) })
      return
    }
    if (parts[2] === 'events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      const send = (): void => { res.write(`data: ${JSON.stringify(wireSnapshot(run.getSnapshot()))}\n\n`) }
      send()
      const stop = run.subscribe(send)
      res.on('close', stop)
      return
    }
    json(res, 405, { error: { code: 'operation-method-not-allowed', message: 'operation method not allowed' } })
  }
}
