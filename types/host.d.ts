import type { ReactNode } from 'react'
export {
  defineCodec,
  defineResource,
  jsonCodec,
  voidCodec,
  type FabricCodec,
  type FabricResourceDefinition,
  type FabricResourceHandlers,
  type FabricResourceScope,
} from './sdk.js'
import type { FabricCodec, FabricResourceDefinition, FabricResourceHandlers } from './sdk.js'

export interface FabricHostPluginDescriptor { readonly name: string; readonly description?: string; readonly icon?: ReactNode }
export interface FabricHostPluginIdentity extends FabricHostPluginDescriptor {
  readonly id: string
  readonly packageName: string
  readonly version: string
  readonly generation: string
}
export type FabricHostDisposer = () => void | Promise<void>
export interface FabricHostLifecycle { readonly signal: AbortSignal; onDispose(cleanup: FabricHostDisposer): void }
export interface FabricPluginResourceHost {
  readonly assets: { provide(assetId: string, handler: unknown): () => void }
  provide<Request, Response, Event = never>(resource: FabricResourceDefinition<Request, Response, Event>, handlers: FabricResourceHandlers<Request, Response, Event>): () => void
}
export interface FabricOperationDefinition<Input, Result, Progress = never> {
  readonly owner: string; readonly id: string; readonly version: string
  readonly input: FabricCodec<Input>; readonly result: FabricCodec<Result>; readonly progress?: FabricCodec<Progress>
}
export interface FabricOperationRunContext<Progress> { readonly signal: AbortSignal; report(progress: Progress): void }
export type FabricOperationHandler<Input, Result, Progress = never> = (input: Input, context: FabricOperationRunContext<Progress>) => Result | Promise<Result>
export interface FabricPluginOperationHost {
  provide<Input, Result, Progress>(operation: FabricOperationDefinition<Input, Result, Progress>, handler: FabricOperationHandler<Input, Result, Progress>): () => void
}
export interface FabricDocumentDefinition<T> { readonly id: string; readonly version: string; readonly codec: FabricCodec<T>; readonly initial: T | (() => T) }
export interface FabricDocumentSnapshot<T> { readonly value: T; readonly revision: number }
export interface FabricDocumentHandle<T> {
  readonly definition: FabricDocumentDefinition<T>
  read(): Promise<FabricDocumentSnapshot<T>>
  replace(value: T, expectedRevision?: number): Promise<FabricDocumentSnapshot<T>>
  update(updater: (current: T) => T): Promise<FabricDocumentSnapshot<T>>
  subscribe(listener: () => void): () => void
  close(): void
}
export interface FabricPluginDocumentHost { open<T>(definition: FabricDocumentDefinition<T>): Promise<FabricDocumentHandle<T>> }
export interface FabricBlobRef { readonly owner: string; readonly id: string; readonly contentType: string; readonly size: number }
export interface FabricBlobValue extends FabricBlobRef { readonly body: Uint8Array }
export interface FabricBlobPutInput { readonly contentType: string; readonly body: Uint8Array }
export interface FabricPluginBlobHost {
  put(input: FabricBlobPutInput): Promise<FabricBlobRef>
  read(ref: FabricBlobRef): Promise<FabricBlobValue>
  delete(ref: FabricBlobRef): Promise<void>
  url(ref: FabricBlobRef): string
}
export interface FabricCredentialDefinition { readonly owner: string; readonly id: string; readonly version: string; readonly ref: string }
export interface FabricCredentialInfo { readonly configured: boolean; readonly source?: string; readonly writable: boolean }
export interface FabricResolvedCredential { readonly value: string; readonly source: string }
export interface FabricPluginCredentialHost {
  declare(definition: FabricCredentialDefinition): void
  resolve(definition: FabricCredentialDefinition): Promise<FabricResolvedCredential | undefined>
  describe(definition: FabricCredentialDefinition): Promise<FabricCredentialInfo>
}
export interface FabricHostPluginContext {
  readonly identity: FabricHostPluginIdentity
  readonly lifecycle: FabricHostLifecycle
  readonly resources: FabricPluginResourceHost
  readonly operations: FabricPluginOperationHost
  readonly documents: FabricPluginDocumentHost
  readonly blobs: FabricPluginBlobHost
  readonly credentials: FabricPluginCredentialHost
}
export interface FabricHostPluginDefinition {
  readonly descriptor: FabricHostPluginDescriptor
  readonly setup: (context: FabricHostPluginContext) => void | FabricHostDisposer | Promise<void | FabricHostDisposer>
}
export declare class FabricDocumentConflictError<T> extends Error { readonly code: 'document-conflict'; readonly current: FabricDocumentSnapshot<T> }
export declare function defineHostPlugin(definition: FabricHostPluginDefinition): FabricHostPluginDefinition
export declare function defineOperation<Input, Result, Progress = never>(definition: FabricOperationDefinition<Input, Result, Progress>): FabricOperationDefinition<Input, Result, Progress>
export declare function defineDocument<T>(definition: FabricDocumentDefinition<T>): FabricDocumentDefinition<T>
export declare function defineCredential(definition: FabricCredentialDefinition): FabricCredentialDefinition
