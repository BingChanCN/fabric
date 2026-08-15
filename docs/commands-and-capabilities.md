# 命令与 Capability

## 页面 action 与全局 command

页面 action 属于当前页面：放在 header，可依赖页面状态，默认不进命令面板、不占全局快捷键。

```ts
ctx.pages.define({
  id: 'home',
  label: 'Jobs',
  view: JobsPage,
  actions: [{ id: 'refresh', component: RefreshAction }],
})
```

全局 command 属于插件 runtime：进 `Mod+K` 面板，可绑快捷键，不依赖页面实例。

```ts
ctx.commands.define({
  id: 'open',
  title: 'Open Jobs',
  shortcut: 'Mod+Shift+J',
  run: (signal) => { ctx.open('home') },
})
```

`Mod` 在 Windows/Linux 是 Ctrl，在 macOS 是 ⌘。异步由 Fabric 管理 pending / cancel；`signal` 在卸载时 abort。

## Capability

Capability 是同运行时的 typed/versioned 服务，不是 UI 扩展点。

```ts
ctx.capabilities.provide({
  id: 'jobs-api',
  version: '1',
  implementation: { refresh: () => {} },
})

const api = ctx.capabilities.require<{ refresh: () => void }>('jobs-api', '1')
api.refresh()
```

Host 对象不能直接交给 Client。跨边界数据走 Resource。provider 卸载后 handle 失效。
