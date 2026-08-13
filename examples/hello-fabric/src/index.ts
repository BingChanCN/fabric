import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

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

/** Host half used by the example's session-aware JSON requests. */
export function apply(ctx: Context): void {
  let enabled = false

  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => {
      const stopStatus = webCtx.webServer.register({
        kind: 'exact',
        path: '/fabric-example/status',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'method-not-allowed' })
            return
          }
          const url = new URL(req.url ?? '/fabric-example/status', `http://${req.headers.host ?? 'localhost'}`)
          writeJson(res, 200, {
            status: 'ok',
            sessionId: url.searchParams.get('sessionId') ?? undefined,
            enabled,
          })
        },
      })

      const stopSettings = webCtx.webServer.register({
        kind: 'exact',
        path: '/fabric-example/settings',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { error: 'method-not-allowed' })
            return
          }
          try {
            const body = await readJson(req)
            if (typeof body !== 'object' || body === null || !('enabled' in body) || typeof body.enabled !== 'boolean') {
              writeJson(res, 400, { error: 'enabled-must-be-boolean' })
              return
            }
            enabled = body.enabled
            writeJson(res, 200, { saved: true, enabled })
          } catch {
            writeJson(res, 400, { error: 'invalid-json' })
          }
        },
      })

      return () => {
        stopSettings()
        stopStatus()
      }
    }, 'fabric-example: web routes')
  })
}
