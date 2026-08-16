export {
  defineCodec,
  defineResource,
  jsonCodec,
  voidCodec,
  type FabricCodec,
  type FabricResourceDefinition,
  type FabricResourceScope,
} from './resource/contract.ts'
export {
  defineCapability,
  type FabricCapabilityDefinition,
  type FabricCapabilitySide,
} from './capability/contract.ts'
export {
  defineOperation,
  type FabricOperationDefinition,
} from './operation/contract.ts'
export {
  defineCredential,
  type FabricCredentialDefinition,
  type FabricCredentialInfo,
} from './credential/contract.ts'
export type { FabricBlobRef } from './blob/contract.ts'
