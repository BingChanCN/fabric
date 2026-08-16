# API 参考

## `@dsh-do/fabric/host`

Runtime Host 作者入口，仅包含 definition 和纯契约 API：

- `defineHostPlugin({ descriptor, setup })`
- `defineResource` / `defineCodec` / `jsonCodec` / `voidCodec`
- `defineCapability` / `defineOperation` / `defineDocument` / `defineCredential`
- `FabricResourceError`

`setup(ctx)` 可用 `identity`、`lifecycle`、`resources`、`operations`、`documents`、`blobs`、`credentials`。真实 package/version/generation identity 由 Core 注入，definition 不能覆盖。

## `@dsh-do/fabric/contracts`

跨包共享的纯契约入口。适合 `./contracts` 导出 codec、Resource/Capability/Operation token、TypeScript 类型和普通常量；禁止导出插件实现、React 组件或运行时状态。

## `@dsh-do/fabric/client`

- `defineClientPlugin({ descriptor, setup })`
- `ctx.pages.define` / `open` / `close` / page handle `setBadge`
- `ctx.commands.define`
- `ctx.config.define`
- `ctx.dialogs.open` / `page.dialogs.open`
- `ctx.hud.define`
- `ctx.capabilities.provide(token, implementation)` / `consume(token)`
- `ctx.operations.start` / `attach`
- `ctx.resources.read` / `mutate` / `watch`
- `ctx.theme.provide` / `clear` / `isDark` / `onChange`
- `ctx.notify`

Capability consumer 返回 observable binding；provider 卸载时旧 implementation proxy 会先 revoke，再发布 unavailable。页面 action 支持声明式 `label` / `icon` / `tone` / `disabled` / `hidden` / `tooltip` / `onClick`，复杂 action 使用互斥的 `render`。

## `@dsh-do/fabric/ui`

`Page`、`PageHeader`、`Section`、`Badge`、`Modal`、`Popover`、`Dropdown`、`AsyncView`、`tokens`、`Z_INDEX`。组件只消费 `--fabric-*`。

## `@dsh-do/fabric/build`

- `fabricRuntimePackage()`：读取 `package.json.fabric`，生成约定的 Host/Client/Contracts 产物。
- `fabricClient()`：Core 自身客户端 bundle 构建入口。

Runtime Package 不使用旧的 profile-bundle `fabricPlugin()` 预设。

## `fabric` CLI

`create`、`build`、`test`、`verify`、`dev`、`pack`。详见 [CLI](cli.md)。
