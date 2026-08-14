import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from 'fabric/client'
import { ExamplePage } from './ExamplePage.tsx'
import { ExampleSettings } from './ExampleSettings.tsx'
import { RefreshAction } from './RefreshAction.tsx'

/** Required service: Fabric must be mounted before this client fiber starts. */
export const inject = ['fabric'] as const

/** Minimal downstream plugin: one page, one toolbar action, and one settings entry. */
export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'page',
    id: 'hello',
    order: 0,
    label: 'Hello Fabric',
    icon: '✨',
    badge: 'v0.2',
    keepAlive: true,
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
    priority: 1,
    scope: 'workbench',
    tokens: {
      '--dsw-alias-brand-primary': '#2563eb',
    },
  })
}
