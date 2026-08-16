# 命令与 Capability

## 页面 action 与全局 command

页面 action 属于页面实例，可依赖页面状态；Promise pending、AbortSignal 和异常通知由 Fabric 管理。复杂交互使用 `render`，不能同时声明 `render` 与 `onClick`。

```ts
ctx.pages.define({
  id: 'home',
  label: 'Jobs',
  view: JobsPage,
  actions: [{
    id: 'refresh',
    label: 'Refresh',
    onClick: async ({ signal, notify }) => {
      await refreshJobs(signal)
      notify('Refreshed', { tone: 'success' })
    },
  }],
})
```

全局 command 进入命令面板，可绑定快捷键：

```ts
ctx.commands.define({
  id: 'open',
  title: 'Open Jobs',
  shortcut: 'Mod+Shift+J',
  run: () => { ctx.open('home') },
})
```

## Capability

Capability 是同一运行环境内的 typed/versioned 直接协作，不跨 Host/Client 传值。

```ts
import { defineCapability } from '@dsh-do/fabric/contracts'

export const jobsCapability = defineCapability<{ refresh(): void }>({
  owner: '@example/jobs',
  id: 'jobs-api',
  version: '1',
  side: 'client',
})

ctx.capabilities.provide(jobsCapability, { refresh: () => {} })
const binding = ctx.capabilities.consume(jobsCapability)
const snapshot = binding.getSnapshot()
if (snapshot.status === 'available') snapshot.implementation.refresh()
```

binding 可订阅 `available | unavailable | incompatible`。provider 卸载时 Fabric 先 revoke 旧 implementation proxy，再发布 unavailable；即使 consumer 缓存了旧 proxy，后续调用也会立即失败。consumer 卸载时调用 `binding.dispose()`，插件 Context 也会自动回收其 binding。

Host Capability 与 Client Capability 分属独立 registry。跨进程数据走 Resource，长任务走 Operation。
