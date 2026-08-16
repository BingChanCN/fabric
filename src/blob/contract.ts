export const FABRIC_BLOB_PREFIX = '/fabric/blob'

export interface FabricBlobRef {
  readonly owner: string
  readonly id: string
  readonly contentType: string
  readonly size: number
}

export interface FabricBlobValue extends FabricBlobRef {
  readonly body: Uint8Array
}

export interface FabricBlobPutInput {
  readonly contentType: string
  readonly body: Uint8Array
}

export interface FabricPluginBlobHost {
  put(input: FabricBlobPutInput): Promise<FabricBlobRef>
  read(ref: FabricBlobRef): Promise<FabricBlobValue>
  delete(ref: FabricBlobRef): Promise<void>
  url(ref: FabricBlobRef): string
}

export interface FabricBlobHost {
  forOwner(owner: string): FabricPluginBlobHost
}

export function fabricBlobUrl(ref: FabricBlobRef): string {
  return `${FABRIC_BLOB_PREFIX}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.id)}`
}
