import { defineHostPlugin, mountHostPlugin } from '@dsh-do/fabric'
import { settingsResource, statusResource } from './resources.ts'

const PACKAGE_VERSION = '0.5.0'

const definition = defineHostPlugin({
  descriptor: {
    name: 'Hello Fabric',
    description: 'Example Host half using Fabric typed Resources.',
  },
  setup({ resources }) {
    let enabled = false
    resources.provide(statusResource, {
      query: (_request, context) => ({
        status: 'ok',
        sessionId: context.session?.id,
        enabled,
      }),
    })
    resources.provide(settingsResource, {
      mutate: request => {
        enabled = request.enabled
        return { saved: true, enabled }
      },
    })
  },
})

export const { inject, apply } = mountHostPlugin('hello-fabric', PACKAGE_VERSION, definition)
