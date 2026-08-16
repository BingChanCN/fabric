import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isConfigId } from '../sdk/config.ts'
import type { JsonRecord } from '../sdk/config.ts'
import type { JsonValue } from '../sdk/json.ts'
import { isFabricPackageName } from '../runtime/manifest.ts'

export interface HostConfigDocument {
  id: string
  seq: number
  values: JsonRecord
}

export type ConfigWriteResult =
  | { ok: true; document: HostConfigDocument }
  | { ok: false; conflict: HostConfigDocument }

function dataRoot(root?: string): string {
  return root ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'fabric', 'data')
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDocument(id: string, raw: string): HostConfigDocument | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || typeof parsed.seq !== 'number' || !Number.isFinite(parsed.seq) || parsed.seq < 0) {
      return undefined
    }
    const values = isRecord(parsed.values) ? parsed.values : {}
    return { id, seq: parsed.seq, values }
  } catch {
    return undefined
  }
}

/** Profile-local config documents isolated by canonical Runtime Package owner. */
export class FabricConfigRepository {
  private readonly root: string
  private readonly ready = new Map<string, Promise<void>>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    root?: string,
    private readonly legacyRoot?: string,
  ) {
    this.root = dataRoot(root)
  }

  async list(owner: string): Promise<readonly Pick<HostConfigDocument, 'id' | 'seq'>[]> {
    const directory = this.directoryFor(owner)
    await this.ensureOwner(owner)
    const names = await readdir(directory)
    const listed: { id: string; seq: number }[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!isConfigId(id)) continue
      const document = await this.read(owner, id)
      listed.push({ id: document.id, seq: document.seq })
    }
    listed.sort((left, right) => left.id.localeCompare(right.id))
    return listed
  }

  async read(owner: string, id: string): Promise<HostConfigDocument> {
    this.validate(owner, id)
    await this.ensureOwner(owner)
    try {
      const raw = await readFile(this.fileFor(owner, id), 'utf8')
      return parseDocument(id, raw) ?? { id, seq: 0, values: {} }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return await this.migrateLegacy(owner, id) ?? { id, seq: 0, values: {} }
      }
      throw error
    }
  }

  async write(owner: string, id: string, seq: number, values: JsonRecord): Promise<ConfigWriteResult> {
    this.validate(owner, id)
    if (!Number.isFinite(seq) || seq < 0) throw new Error('seq must be a finite non-negative number')
    if (!isRecord(values)) throw new Error('values must be a JSON object')
    const operation = this.writeQueue.then(async () => {
      const current = await this.read(owner, id)
      if (current.seq !== seq) return { ok: false, conflict: current } as const
      const document: HostConfigDocument = { id, seq: current.seq + 1, values }
      await this.commit(this.fileFor(owner, id), document)
      return { ok: true, document } as const
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async migrateLegacy(owner: string, id: string): Promise<HostConfigDocument | undefined> {
    const legacyPrefix = owner === '@dsh-do/hello-fabric'
      ? 'hello-fabric.'
      : owner === '@dsh-do/fabric-theme-studio'
        ? 'fabric-theme-studio.'
        : undefined
    if (this.legacyRoot === undefined || legacyPrefix === undefined || !id.startsWith(legacyPrefix)) return undefined
    try {
      const raw = await readFile(join(this.legacyRoot, `${id}.json`), 'utf8')
      const document = parseDocument(id, raw)
      if (document === undefined) return undefined
      await this.commit(this.fileFor(owner, id), document)
      return document
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async commit(destination: string, document: HostConfigDocument): Promise<void> {
    const temporary = join(dirname(destination), `.${document.id}.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    try {
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  private validate(owner: string, id: string): void {
    if (!isFabricPackageName(owner)) throw new Error(`invalid config owner "${owner}"`)
    if (!isConfigId(id)) throw new Error(`invalid config id "${id}"`)
  }

  private directoryFor(owner: string): string {
    if (!isFabricPackageName(owner)) throw new Error(`invalid config owner "${owner}"`)
    return join(this.root, encodeURIComponent(owner), 'config')
  }

  private fileFor(owner: string, id: string): string {
    return join(this.directoryFor(owner), `${id}.json`)
  }

  private ensureOwner(owner: string): Promise<void> {
    let ready = this.ready.get(owner)
    if (ready === undefined) {
      ready = mkdir(this.directoryFor(owner), { recursive: true }).then(() => undefined)
      this.ready.set(owner, ready)
    }
    return ready
  }
}
