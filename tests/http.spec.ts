import { describe, expect, it, vi } from 'vitest'
import { FabricHttpError, createJsonClient } from '../src/sdk/http.ts'

describe('createJsonClient', () => {
  it('injects the current session and JSON-encodes request bodies', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://host.test/mc/items?filter=open&sessionId=session-42')
      expect(init?.method).toBe('POST')
      expect(init).not.toHaveProperty('session')
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
      expect(init?.body).toBe(JSON.stringify({ title: 'hello' }))
      return new Response(JSON.stringify({ id: 7 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createJsonClient({
      baseUrl: 'https://host.test/mc/',
      sessionId: () => 'session-42',
      fetch: fetcher,
    })

    await expect(client.post<{ id: number }>('items?filter=open', { title: 'hello' })).resolves.toEqual({ id: 7 })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('allows global requests to skip the session parameter', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://host.test/status')
      return new Response(null, { status: 204 })
    })
    const client = createJsonClient({
      baseUrl: 'https://host.test/api/',
      sessionId: () => 'session-42',
      fetch: fetcher,
    })
    await expect(client.get('/status', { session: false })).resolves.toBeUndefined()
  })

  it('throws a structured error for non-success responses', async () => {
    const client = createJsonClient({
      baseUrl: 'https://host.test/api/',
      fetch: async () => new Response(JSON.stringify({ message: 'Not ready', code: 'NOT_READY' }), {
        status: 409,
        statusText: 'Conflict',
        headers: { 'content-type': 'application/json' },
      }),
    })

    const error = await client.get('state').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(FabricHttpError)
    expect(error).toMatchObject({ message: 'Not ready', status: 409, code: 'NOT_READY' })
  })
})
