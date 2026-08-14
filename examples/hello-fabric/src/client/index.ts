import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@dsh-do/fabric/client'
import { ExamplePage } from './ExamplePage.tsx'
import { ExampleSettings } from './ExampleSettings.tsx'
import { RefreshAction } from './RefreshAction.tsx'

/** Required service: Fabric must be mounted before this client fiber starts. */
export const inject = ['fabric'] as const

/** Minimal downstream plugin: page, toolbar, settings, theme, mod card, and config schema. */
export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'mod',
    id: 'hello-fabric',
    name: 'Hello Fabric',
    version: '0.4.0',
    description: 'Example downstream plugin for the Fabric workbench.',
    icon: '✨',
  })

  ctx.fabric.register({
    kind: 'page',
    id: 'hello',
    order: 0,
    label: 'Hello Fabric',
    icon: '✨',
    badge: 'v0.4',
    keepAlive: true,
    pluginId: 'hello-fabric',
    component: ExamplePage,
  })

  ctx.fabric.register({
    kind: 'toolbar',
    id: 'hello-refresh',
    order: 0,
    component: RefreshAction,
  })

  ctx.fabric.register({
    kind: 'settings',
    id: 'hello-fabric',
    order: 0,
    component: ExampleSettings,
  })

  ctx.fabric.register({
    kind: 'theme',
    id: 'hello-fabric-theme',
    pluginId: 'hello-fabric',
    priority: 1,
    scope: 'workbench',
    tokens: {
      '--dsw-alias-brand-primary': '#2563eb',
    },
  })

  ctx.fabric.registerConfig({
    id: 'hello-fabric',
    title: 'Hello Fabric',
    description: 'Persisted through Fabric\'s host config store.',
    pluginId: 'hello-fabric',
    schema: {
      enabled: {
        type: 'boolean',
        title: 'Enable example extras',
        description: 'Stored under /fabric/config/hello-fabric and kept race-safe.',
        default: false,
      },
    },
  })

  ctx.fabric.registerCapability('hello-status', {
    ping: () => 'ok',
  })

  ctx.fabric.register({
    kind: 'command',
    id: 'hello.notify',
    title: 'Hello Fabric: Notify',
    shortcut: 'Mod+Shift+H',
    pluginId: 'hello-fabric',
    handler: () => {
      const status = ctx.fabric.getCapability<{ ping: () => string }>('hello-status')
      ctx.fabric.notify(status?.ping() === 'ok' ? 'Hello from a command' : 'capability missing', {
        tone: 'success',
      })
    },
  })
}
