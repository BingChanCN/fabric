# 配置

Config 是持久化的唯一真源。Settings 只是它的投影，不再单独注册 settings slot。

```ts
const preferences = ctx.config.define({
  id: 'preferences',
  title: 'Jobs',
  schema: {
    pollMs: { type: 'number', title: 'Refresh interval', default: 4000, min: 500 },
  },
  settings: JobsSettings,
})
```

`id` 会自动变成 `<runtimePluginId>.preferences`。页面通过 `page.config(preferences.id)` 拿到同一份 handle：

- `getSnapshot()` / `subscribe()`
- `set(patch)` / `reset()`
- `load()` / `persist()`

Host 通过内置 `fabric/config` Resource 做 schema 校验、seq 冲突和落盘。业务代码不知道文件路径、HTTP 状态码或 `/fabric/config/*`。迟到的 GET 不会覆盖未保存的本地修改；409 由 runtime 处理。
