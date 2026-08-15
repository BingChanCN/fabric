# API 参考

## `@dsh-do/fabric`（Host）

- `defineHostPlugin({ descriptor, setup })`
- `mountHostPlugin(packageName, version, definition)` → `{ inject, apply }`
- `defineResource` / `defineCodec` / `jsonCodec` / `voidCodec`
- `FabricResourceError`
- `assetUrl(pluginId, assetId, path)`

`setup(context)` 提供 `identity`、`lifecycle`、`resources`。`resources.provide(resource, handlers)` 已绑定当前插件，不要再传 `pluginId`。

## `@dsh-do/fabric/client`

- `defineClientPlugin({ descriptor, setup })`
- `mountClientPlugin`（构建生成，业务不要手写）
- `ctx.pages.define` / `open` / `close`；page handle 提供 `setBadge`
- `ctx.commands.define`
- `ctx.config.define`
- `ctx.dialogs.open`（插件 scope）
- `page.dialogs.open`（页面 scope）
- `ctx.hud.define`（常驻、非模态 HUD）
- `ctx.capabilities.provide` / `require` / `optional`
- `ctx.theme.provide` / `clear` / `isDark` / `onChange`
- `ctx.resources.read` / `mutate` / `watch`
- `ctx.notify`

页面组件拿到 `FabricPageProps`，其中 `page` 是更窄的 `FabricPageContext`。`dialogs.open` 返回 `{ id, close, update }`；同一 scope 内重复打开同一 id 会替换原 dialog。页面 action 支持声明式 `label` / `icon` / `tone` / `disabled` / `hidden` / `tooltip` / `onClick`，复杂 action 使用互斥的 `render`。

## `@dsh-do/fabric/ui`

`Page`、`PageHeader`、`Section`、`Badge`、`Modal`、`Popover`、`Dropdown`、`AsyncView`、`tokens`、`Z_INDEX`。组件只消费 `--fabric-*`。

## `@dsh-do/fabric/build`

`fabricPlugin({ id })` / `fabricClient({ id, runtime? })`。下游 `id` 必须等于 `package.json.name`。
