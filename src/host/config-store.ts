import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isConfigId } from '../sdk/config.ts'
import type { JsonRecord } from '../sdk/config.ts'
import type { JsonValue } from '../sdk/http.ts'

export interface HostConfigDocument {
  id: string
  seq: number
  values: JsonRecord
}

export type ConfigWriteResult =
  | { ok: true; document: HostConfigDocument }
  | { ok: false; conflict: HostConfigDocument }

function configRoot(root?: string): string {
  return root ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'fabric', 'config')
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

/** File-backed config documents keyed by id, with monotonic seq conflict checks. */
export class FabricConfigRepository {
  private readonly root: string
  private ready: Promise<void> | undefined

  constructor(root?: string) {
    this.root = configRoot(root)
  }

  async list(): Promise<readonly Pick<HostConfigDocument, 'id' | 'seq'>[]> {
    await this.ensureRoot()
    const names = await readdir(this.root)
    const listed: { id: string; seq: number }[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!isConfigId(id)) continue
      const document = await this.read(id)
      listed.push({ id: document.id, seq: document.seq })
    }
    listed.sort((left, right) => left.id.localeCompare(right.id))
    return listed
  }

  async read(id: string): Promise<HostConfigDocument> {
    if (!isConfigId(id)) throw new Error(`invalid config id "${id}"`)
    await this.ensureRoot()
    try {
      const raw = await readFile(this.fileFor(id), 'utf8')
      return parseDocument(id, raw) ?? { id, seq: 0, values: {} }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { id, seq: 0, values: {} }
      throw error
    }
  }

  async write(id: string, seq: number, values: JsonRecord): Promise<ConfigWriteResult> {
    if (!isConfigId(id)) throw new Error(`invalid config id "${id}"`)
    if (!Number.isFinite(seq) || seq < 0) throw new Error('seq must be a finite non-negative number')
    if (!isRecord(values)) throw new Error('values must be a JSON object')
    const current = await this.read(id)
    if (current.seq !== seq) return { ok: false, conflict: current }
    const document: HostConfigDocument = { id, seq: current.seq + 1, values }
    await this.ensureRoot()
    await writeFile(this.fileFor(id), `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    return { ok: true, document }
  }

  private fileFor(id: string): string {
    return join(this.root, `${id}.json`)
  }

  private ensureRoot(): Promise<void> {
    this.ready ??= mkdir(this.root, { recursive: true }).then(() => undefined)
    return this.ready
  }
}
