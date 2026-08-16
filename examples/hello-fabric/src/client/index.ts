import { defineCapability, defineClientPlugin, type FabricClientPluginContext, type FabricConfigDefinition, type FabricPageDefinition } from '@dsh-do/fabric/client'
import { ExamplePage } from './ExamplePage.tsx'
import { ExampleSettings } from './ExampleSettings.tsx'

const configDefinition: FabricConfigDefinition<{ enabled: boolean }> = {
  id: 'preferences',
  title: 'Hello Fabric 偏好设置',
  description: '示例插件的持久化配置。',
  schema: {
    enabled: {
      type: 'boolean',
      title: 'Enable example extras',
      description: '由 Fabric Host config store 持久化。',
      default: false,
    },
  },
  settings: ExampleSettings,
}

const statusCapability = defineCapability<{ ping(): string }>({
  owner: 'hello-fabric',
  id: 'status',
  version: '1',
  side: 'client',
})

const definition = defineClientPlugin({
  descriptor: {
    name: 'Hello Fabric',
    description: 'Example downstream plugin using Fabric public contracts.',
    icon: 'HF',
  },
  setup(ctx: FabricClientPluginContext) {
    const preferences = ctx.config.define(configDefinition)
    ctx.capabilities.provide(statusCapability, { ping: () => 'ok' })
    const status = ctx.capabilities.consume(statusCapability)
    ctx.theme.provide('accent', {
      surface: {
        base: '#111827', raised: '#1f2937', sunken: '#0f172a', muted: '#1e293b', overlay: 'rgba(0, 0, 0, 0.5)',
      },
      content: {
        primary: '#f8fafc', secondary: '#cbd5e1', tertiary: '#94a3b8', disabled: '#64748b', inverse: '#0f172a',
      },
      border: { subtle: '#334155', default: '#475569', strong: '#64748b', focus: '#38bdf8' },
      accent: { primary: '#38bdf8', hover: '#7dd3fc', active: '#0ea5e9', surface: 'rgba(56, 189, 248, 0.16)' },
      state: {
        info: { foreground: '#38bdf8', surface: 'rgba(56, 189, 248, 0.16)', border: 'rgba(56, 189, 248, 0.32)' },
        success: { foreground: '#4ade80', surface: 'rgba(74, 222, 128, 0.16)', border: 'rgba(74, 222, 128, 0.32)' },
        warning: { foreground: '#fbbf24', surface: 'rgba(251, 191, 36, 0.16)', border: 'rgba(251, 191, 36, 0.32)' },
        danger: { foreground: '#fb7185', surface: 'rgba(251, 113, 133, 0.16)', border: 'rgba(251, 113, 133, 0.32)' },
      },
      interaction: { hover: 'rgba(255, 255, 255, 0.06)', active: 'rgba(56, 189, 248, 0.18)', selected: 'rgba(56, 189, 248, 0.14)', focus: '#38bdf8' },
      material: { acrylicBackground: 'rgba(15, 23, 42, 0.82)', acrylicFilter: 'blur(16px)', edgeHighlight: 'rgba(255, 255, 255, 0.14)', shadow: '0 12px 32px rgba(0, 0, 0, 0.28)' },
    }, { priority: -10 })

    const page: FabricPageDefinition = {
      id: 'home', order: 0, label: 'Hello Fabric', icon: 'HF', keepAlive: true,
      scope: 'session',
      config: [preferences],
      view: ExamplePage,
      actions: [{
        id: 'refresh',
        order: 0,
        label: 'Refresh example page',
        icon: '↻',
        onClick: ({ notify, pageId }) => {
          notify(`Refreshed ${pageId}`, { tone: 'info' })
        },
      }],
    }
    const pageHandle = ctx.pages.define(page)
    pageHandle.setBadge('0.7')
    ctx.commands.define({
      id: 'notify',
      title: 'Hello Fabric: Notify',
      description: '通过 Fabric command 触发通知。',
      shortcut: 'Mod+Shift+H',
      run: () => {
        const snapshot = status.getSnapshot()
        ctx.notify(snapshot.value?.ping() === 'ok' ? 'Hello from a command' : 'capability unavailable', {
          tone: snapshot.status === 'available' ? 'success' : 'warning',
        })
      },
    })
  },
})

export default definition
export { definition }
