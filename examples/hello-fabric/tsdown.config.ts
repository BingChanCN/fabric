import { defineConfig } from 'tsdown'
import { fabricPlugin } from '@cortexkit/fabric/build'

export default defineConfig(fabricPlugin({
  id: '@cortexkit/fabric-example',
}))
