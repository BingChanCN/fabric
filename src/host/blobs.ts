import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  FABRIC_BLOB_PREFIX, fabricBlobUrl,
  type FabricBlobHost, type FabricBlobPutInput, type FabricBlobRef, type FabricBlobValue,
  type FabricPluginBlobHost,
} from '../blob/contract.ts'
import { fabricPackageDataPath } from './documents.ts'
import { isFabricPackageName } from '../runtime/manifest.ts'
import type { FabricInventoryStore } from './package-store.ts'

const BLOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

interface BlobMetadata extends FabricBlobRef {}

function validateContentType(value: string): string {
  const contentType = value.trim()
  if (contentType === '' || /[\r\n]/u.test(contentType)) throw new Error('fabric blob contentType is invalid')
  return contentType
}

function parseMetadata(owner: string, id: string, value: unknown): BlobMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('fabric blob metadata is malformed')
  const raw = value as Record<string, unknown>
  if (raw.owner !== owner || raw.id !== id || typeof raw.contentType !== 'string'
    || typeof raw.size !== 'number' || !Number.isSafeInteger(raw.size) || raw.size < 0) {
    throw new Error('fabric blob metadata is malformed')
  }
  return Object.freeze({ owner, id, contentType: validateContentType(raw.contentType), size: raw.size })
}

class PluginBlobHost implements FabricPluginBlobHost {
  constructor(private readonly service: FabricBlobService, private readonly owner: string) {}

  put(input: FabricBlobPutInput): Promise<FabricBlobRef> {
    return this.service.put(this.owner, input)
  }

  read(ref: FabricBlobRef): Promise<FabricBlobValue> {
    this.assertOwner(ref)
    return this.service.read(this.owner, ref.id)
  }

  delete(ref: FabricBlobRef): Promise<void> {
    this.assertOwner(ref)
    return this.service.delete(this.owner, ref.id)
  }

  url(ref: FabricBlobRef): string {
    this.assertOwner(ref)
    return fabricBlobUrl(ref)
  }

  private assertOwner(ref: FabricBlobRef): void {
    if (ref.owner !== this.owner) throw new Error(`fabric blob "${ref.id}" belongs to another package`)
  }
}

/** Opaque profile-local binary store scoped to canonical Runtime Package owners. */
export class FabricBlobService implements FabricBlobHost {
  constructor(private readonly profileRoot: string) {}

  forOwner(owner: string): FabricPluginBlobHost {
    if (!isFabricPackageName(owner)) throw new Error(`fabric blob owner "${owner}" is invalid`)
    return new PluginBlobHost(this, owner)
  }

  async put(owner: string, input: FabricBlobPutInput): Promise<FabricBlobRef> {
    if (!(input.body instanceof Uint8Array)) throw new Error('fabric blob body must be a Uint8Array')
    const id = randomUUID()
    const contentType = validateContentType(input.contentType)
    const metadata: BlobMetadata = Object.freeze({ owner, id, contentType, size: input.body.byteLength })
    const root = this.blobsRoot(owner)
    const staging = join(root, '.staging', `${id}-${randomUUID()}`)
    const destination = join(root, id)
    try {
      await mkdir(staging, { recursive: true })
      await writeFile(join(staging, 'body'), input.body)
      await writeFile(join(staging, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      await rename(staging, destination)
      return metadata
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async read(owner: string, id: string): Promise<FabricBlobValue> {
    this.assertIdentity(owner, id)
    const directory = join(this.blobsRoot(owner), id)
    const metadata = parseMetadata(owner, id, JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as unknown)
    const body = new Uint8Array(await readFile(join(directory, 'body')))
    if (body.byteLength !== metadata.size) throw new Error(`fabric blob "${id}" size does not match its metadata`)
    return Object.freeze({ ...metadata, body })
  }

  async delete(owner: string, id: string): Promise<void> {
    this.assertIdentity(owner, id)
    await rm(join(this.blobsRoot(owner), id), { recursive: true, force: true })
  }

  private blobsRoot(owner: string): string {
    return join(fabricPackageDataPath(this.profileRoot, owner), 'blobs')
  }

  private assertIdentity(owner: string, id: string): void {
    if (!isFabricPackageName(owner)) throw new Error(`fabric blob owner "${owner}" is invalid`)
    if (!BLOB_ID.test(id)) throw new Error(`fabric blob id "${id}" is invalid`)
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: { code: 'blob-not-found', message: 'fabric blob not found' } }))
}

export function fabricBlobRouteHandler(service: FabricBlobService, inventory: FabricInventoryStore) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? FABRIC_BLOB_PREFIX, 'http://localhost')
    if (!url.pathname.startsWith(`${FABRIC_BLOB_PREFIX}/`)) {
      notFound(res)
      return
    }
    const parts = url.pathname.slice(FABRIC_BLOB_PREFIX.length + 1).split('/')
    if (parts.length !== 2) {
      notFound(res)
      return
    }
    let owner: string
    let id: string
    try {
      owner = decodeURIComponent(parts[0]!)
      id = decodeURIComponent(parts[1]!)
    } catch {
      notFound(res)
      return
    }
    const desired = (await inventory.read()).plugins[owner]
    if (desired?.enabled !== true) {
      notFound(res)
      return
    }
    try {
      const blob = await service.read(owner, id)
      res.writeHead(200, {
        'content-type': blob.contentType,
        'content-length': blob.size,
        'cache-control': 'no-store',
      })
      if (req.method === 'HEAD') res.end()
      else res.end(blob.body)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') notFound(res)
      else {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { code: 'blob-invalid', message: error instanceof Error ? error.message : String(error) } }))
      }
    }
  }
}
