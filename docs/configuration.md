# 配置

Config 是持久化真源，Settings 是自动投影。

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

公开 Config ID 由完整 canonical package name 派生，例如 `@example/jobs` 的 `preferences` 为 `example.jobs.preferences`；Host 存储另按 canonical owner 隔离，不会与其他 scope 或同短名包冲突。

handle 提供：

- `getSnapshot()` / `subscribe()`
- `set(patch)` / `reset()`
- `load()` / `persist()`

Host 内置 Config Resource 执行 schema 校验、revision/CAS 冲突检查和原子 JSON 写入，落点为当前 Profile 的 `.fabric/data/<encoded-package>/config/`。插件不接触文件路径或 HTTP 状态码。迟到读取不会覆盖未保存的本地修改。

升级、disable、remove 保留 Config；purge 删除整个 Fabric-owned package data namespace。Fabric 1.0 只对官方 0.x hello-fabric 与 Theme Studio 配置执行不覆盖新数据的一次性迁移。
