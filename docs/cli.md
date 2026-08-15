# create-fabric-plugin

```sh
npx create-fabric-plugin my-plugin
npx create-fabric-plugin @dsh-do/my-plugin
```

生成：

- `defineClientPlugin` 客户端定义（无 `inject` / `apply` / `ClientContext`）
- `defineHostPlugin` + `mountHostPlugin` Host 入口
- `dsh.client.inject: ["@dsh-do/fabric"]`
- `fabricPlugin({ id })`，`id` 等于 `package.json.name`
- peer `@dsh-do/fabric@^0.6.0`

scoped 名会把目录建成短名（`my-plugin`），`package.json.name` 保留 `@scope/name`，runtime id 自动剥 scope。
