import { defineConfig } from 'tsdown'
import { fabricRuntimePackage } from '@dsh-do/fabric/build'

export default defineConfig(fabricRuntimePackage({
  id: 'hello-fabric',
  hostEntry: 'src/index.ts',
}))
