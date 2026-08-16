import type { FabricCodec } from '../resource/contract.ts'

const DOCUMENT_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u

export interface FabricDocumentDefinition<T> {
  readonly id: string
  readonly version: string
  readonly codec: FabricCodec<T>
  readonly initial: T | (() => T)
}

export interface FabricDocumentSnapshot<T> {
  readonly value: T
  readonly revision: number
}

export interface FabricDocumentHandle<T> {
  readonly definition: FabricDocumentDefinition<T>
  read(): Promise<FabricDocumentSnapshot<T>>
  replace(value: T, expectedRevision?: number): Promise<FabricDocumentSnapshot<T>>
  update(updater: (current: T) => T): Promise<FabricDocumentSnapshot<T>>
  subscribe(listener: () => void): () => void
  close(): void
}

export interface FabricPluginDocumentHost {
  open<T>(definition: FabricDocumentDefinition<T>): Promise<FabricDocumentHandle<T>>
}

export interface FabricDocumentHost {
  open<T>(owner: string, definition: FabricDocumentDefinition<T>): Promise<FabricDocumentHandle<T>>
}

export class FabricDocumentConflictError<T> extends Error {
  readonly code = 'document-conflict'

  constructor(readonly current: FabricDocumentSnapshot<T>) {
    super(`fabric document changed at revision ${current.revision}`)
    this.name = 'FabricDocumentConflictError'
  }
}

export function defineDocument<T>(definition: FabricDocumentDefinition<T>): FabricDocumentDefinition<T> {
  if (!DOCUMENT_ID.test(definition.id)) throw new Error(`fabric document id "${definition.id}" is invalid`)
  if (definition.version.trim() === '') throw new Error(`fabric document "${definition.id}" version is empty`)
  return Object.freeze({ ...definition })
}
