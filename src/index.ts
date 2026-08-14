import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { isConfigId } from './sdk/config.ts'
import type { JsonRecord } from './sdk/config.ts'
import { FabricConfigRepository } from './host/config-store.ts'

const PREFIX = '/fabric/config'

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of req) body += chunk.toString()
  return body === '' ? undefined : JSON.parse(body)
}

function configIdFromPath(pathname: string): string | undefined {
  if (pathname === PREFIX) return undefined
  if (!pathname.startsWith(`${PREFIX}/`)) return undefined
  const id = pathname.slice(PREFIX.length + 1)
  return id === '' ? undefined : id
}

export async function handleFabricConfigRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repository: FabricConfigRepository,
): Promise<void> {
  const url = new URL(req.url ?? PREFIX, `http://${req.headers.host ?? 'localhost'}`)
  const id = configIdFromPath(url.pathname)
  const method = req.method ?? 'GET'

  if (id === undefined) {
    if (method !== 'GET') {
      writeJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    writeJson(res, 200, { configs: await repository.list() })
    return
  }

  if (!isConfigId(id)) {
    writeJson(res, 400, { error: 'invalid-config-id', id })
    return
  }

  if (method === 'GET') {
    writeJson(res, 200, await repository.read(id))
    return
  }

  if (method !== 'PUT') {
    writeJson(res, 405, { error: 'method-not-allowed' })
    return
  }

  try {
    const body = await readJson(req)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      writeJson(res, 400, { error: 'invalid-json' })
      return
    }
    const seq = (body as { seq?: unknown }).seq
    const values = (body as { values?: unknown }).values
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0) {
      writeJson(res, 400, { error: 'seq-must-be-non-negative' })
      return
    }
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      writeJson(res, 400, { error: 'values-must-be-object' })
      return
    }
    const result = await repository.write(id, seq, values as JsonRecord)
    if (!result.ok) {
      writeJson(res, 409, result.conflict)
      return
    }
    writeJson(res, 200, result.document)
  } catch {
    writeJson(res, 400, { error: 'invalid-json' })
  }
}

/** Host half: persist Fabric config documents under $DSH_HOME/fabric/config. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], webCtx => {
    const repository = new FabricConfigRepository()
    webCtx.effect(() => {
      const stop = webCtx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => {
          void handleFabricConfigRequest(req, res, repository)
        },
      })
      return () => { stop() }
    }, 'fabric: config routes')
  })
}
