import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import {
  defineDocument, FabricDocumentConflictError,
  type FabricDocumentDefinition, type FabricDocumentHandle, type FabricDocumentHost,
  type FabricDocumentSnapshot,
} from '../document/contract.ts'
import { isFabricPackageName } from '../runtime/manifest.ts'

interface StoredDocument {
  readonly version: string
  readonly revision: number
  readonly value: unknown
}

interface DocumentRecord<T> {
  readonly owner: string
  readonly definition: FabricDocumentDefinition<T>
  readonly file: string
  snapshot: FabricDocumentSnapshot<T>
  queue: Promise<void>
  handles: number
  readonly listeners: Set<() => void>
}

function packageDirectoryName(owner: string): string {
  return encodeURIComponent(owner)
}

export function fabricPackageDataPath(profileRoot: string, owner: string): string {
  if (!isFabricPackageName(owner)) throw new Error(`fabric package owner "${owner}" is invalid`)
  return join(resolve(profileRoot), '.fabric', 'data', packageDirectoryName(owner))
}

function initialValue<T>(definition: FabricDocumentDefinition<T>): T {
  return definition.codec.parse(typeof definition.initial === 'function'
    ? (definition.initial as () => T)()
    : definition.initial)
}

function parseStored<T>(definition: FabricDocumentDefinition<T>, value: unknown): FabricDocumentSnapshot<T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`fabric document "${definition.id}" is malformed`)
  const raw = value as Record<string, unknown>
  if (raw.version !== definition.version) {
    throw new Error(`fabric document "${definition.id}" requires version "${definition.version}", stored version is "${String(raw.version)}"`)
  }
  if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw new Error(`fabric document "${definition.id}" revision is invalid`)
  }
  return Object.freeze({ value: definition.codec.parse(raw.value), revision: raw.revision })
}

async function writeAtomic(file: string, value: StoredDocument): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

class DocumentHandle<T> implements FabricDocumentHandle<T> {
  private closed = false
  private readonly subscriptions = new Set<() => void>()

  constructor(
    readonly definition: FabricDocumentDefinition<T>,
    private readonly service: FabricDocumentService,
    private readonly record: DocumentRecord<T>,
  ) {}

  read(): Promise<FabricDocumentSnapshot<T>> {
    this.assertOpen()
    return this.record.queue.then(() => this.record.snapshot)
  }

  replace(value: T, expectedRevision?: number): Promise<FabricDocumentSnapshot<T>> {
    this.assertOpen()
    return this.service.replace(this.record, value, expectedRevision)
  }

  update(updater: (current: T) => T): Promise<FabricDocumentSnapshot<T>> {
    this.assertOpen()
    return this.service.update(this.record, updater)
  }

  subscribe(listener: () => void): () => void {
    this.assertOpen()
    this.record.listeners.add(listener)
    const unsubscribe = (): void => {
      this.subscriptions.delete(unsubscribe)
      this.record.listeners.delete(listener)
    }
    this.subscriptions.add(unsubscribe)
    return unsubscribe
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const unsubscribe of [...this.subscriptions]) unsubscribe()
    this.service.release(this.record)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`fabric document "${this.definition.id}" handle is closed`)
  }
}

/** Profile-local typed JSON document store for Runtime Package Host fibers. */
export class FabricDocumentService implements FabricDocumentHost {
  private readonly records = new Map<string, DocumentRecord<unknown>>()
  private readonly loading = new Map<string, Promise<DocumentRecord<unknown>>>()

  constructor(private readonly profileRoot: string) {}

  async open<T>(owner: string, rawDefinition: FabricDocumentDefinition<T>): Promise<FabricDocumentHandle<T>> {
    if (!isFabricPackageName(owner)) throw new Error(`fabric document owner "${owner}" is invalid`)
    const definition = defineDocument(rawDefinition)
    const key = `${owner}:${definition.id}`
    let record = this.records.get(key) as DocumentRecord<T> | undefined
    if (record !== undefined && record.definition.version !== definition.version) {
      throw new Error(`fabric document "${owner}/${definition.id}" is already open at version "${record.definition.version}"`)
    }
    if (record === undefined) {
      let pending = this.loading.get(key) as Promise<DocumentRecord<T>> | undefined
      if (pending === undefined) {
        pending = this.load(owner, definition)
        this.loading.set(key, pending as Promise<DocumentRecord<unknown>>)
      }
      try {
        record = await pending
        this.records.set(key, record as DocumentRecord<unknown>)
      } finally {
        this.loading.delete(key)
      }
    }
    record.handles += 1
    return new DocumentHandle(definition, this, record)
  }

  async replace<T>(record: DocumentRecord<T>, rawValue: T, expectedRevision?: number): Promise<FabricDocumentSnapshot<T>> {
    let result!: FabricDocumentSnapshot<T>
    const operation = record.queue.then(async () => {
      if (expectedRevision !== undefined && record.snapshot.revision !== expectedRevision) {
        throw new FabricDocumentConflictError(record.snapshot)
      }
      const value = record.definition.codec.parse(rawValue)
      result = Object.freeze({ value, revision: record.snapshot.revision + 1 })
      await writeAtomic(record.file, {
        version: record.definition.version,
        revision: result.revision,
        value,
      })
      record.snapshot = result
      for (const listener of [...record.listeners]) listener()
    })
    record.queue = operation.then(() => undefined, () => undefined)
    await operation
    return result
  }

  async update<T>(record: DocumentRecord<T>, updater: (current: T) => T): Promise<FabricDocumentSnapshot<T>> {
    let result!: FabricDocumentSnapshot<T>
    const operation = record.queue.then(async () => {
      const value = record.definition.codec.parse(updater(record.snapshot.value))
      result = Object.freeze({ value, revision: record.snapshot.revision + 1 })
      await writeAtomic(record.file, {
        version: record.definition.version,
        revision: result.revision,
        value,
      })
      record.snapshot = result
      for (const listener of [...record.listeners]) listener()
    })
    record.queue = operation.then(() => undefined, () => undefined)
    await operation
    return result
  }

  release<T>(record: DocumentRecord<T>): void {
    record.handles -= 1
    if (record.handles > 0) return
    const key = `${record.owner}:${record.definition.id}`
    void record.queue.finally(() => {
      if (record.handles !== 0) return
      record.listeners.clear()
      if (this.records.get(key) === record) this.records.delete(key)
    })
  }

  private async load<T>(owner: string, definition: FabricDocumentDefinition<T>): Promise<DocumentRecord<T>> {
    const file = join(fabricPackageDataPath(this.profileRoot, owner), 'documents', `${definition.id}.json`)
    let snapshot: FabricDocumentSnapshot<T>
    try {
      snapshot = parseStored(definition, JSON.parse(await readFile(file, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      snapshot = Object.freeze({ value: initialValue(definition), revision: 0 })
    }
    return {
      owner,
      definition,
      file,
      snapshot,
      queue: Promise.resolve(),
      handles: 0,
      listeners: new Set(),
    }
  }
}
