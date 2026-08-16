import { defineHostPlugin } from '@dsh-do/fabric/host'
import { settingsResource, statusResource } from './resources.ts'

const definition = defineHostPlugin({
  descriptor: {
    name: 'Hello Fabric',
    description: 'Example Host half using Fabric typed Resources.',
  },
  setup({ resources }) {
    let enabled = false
    resources.provide(statusResource, {
      query: () => ({ status: 'ok', enabled }),
    })
    resources.provide(settingsResource, {
      mutate: request => {
        enabled = request.enabled
        return { saved: true, enabled }
      },
    })
  },
})

export default definition
