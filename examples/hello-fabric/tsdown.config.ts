import { defineConfig } from 'tsdown'
import { fabricPlugin } from 'fabric/build'

export default defineConfig(fabricPlugin({
  id: 'hello-fabric',
}))
