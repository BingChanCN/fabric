# Changelog

## 1.0.0

- Fabric Core 成为唯一进入 DSH boot graph 的静态基础插件；生态插件改为 profile-local Runtime Package，支持即时安装、启停、升级、回退、remove 和 purge。
- 新增不可变 package store、`plugins.json` desired state、Host-first/Client-first reconcile、多标签页 generation 确认和 current/previous 失败恢复。
- 新增 npm/file:tgz/directory 安装源、registry integrity、无副作用 manifest/bundle validator 和 staging/orphan 清理；Runtime 代码视为可信本机代码，不执行 lifecycle script。
- 新增 profile-only Resource/Capability/Operation contract identity、revocable Capability binding、可重连 Operation transport，以及 Config/Document/Blob/Credential 数据平面。
- 新增 Mods 控制面、`fabric create/build/test/verify/dev/pack`、真实 tgz 闸门和 lease-based 开发 overlay。
- canonical identity 改为完整 npm package name，不再剥 scope；删除 0.x Capability 兼容层和静态 `fabricPlugin()` 构建预设。
- hello-fabric 与 Fabric Theme Studio 迁为首批 Runtime Package；完整 DSH 双标签页浏览器闸门覆盖 dsh-do 安装、更新/回退、失败候选、开发热换与重启恢复。

## 0.7.0

- **Page 工作单元**：action 默认改为声明式 `label` / `icon` / `tone` / `disabled` / `hidden` / `tooltip` / `onClick`；Promise 自动 pending、异常进入通知、切页时 abort。复杂交互通过互斥的 `render` 逃生口实现。
- **响应式 badge**：`ctx.pages.define()` 返回的 handle 新增 `setBadge(value)`，更新会立即投影到 Workbench 导航。
- **Dialog 服务**：新增插件级 `ctx.dialogs.open()` 与页面级 `page.dialogs.open()`；支持 stack、同 id 替换、handle update/close、Esc 只关顶层，以及插件/页面卸载自动回收。
- **HUD clean break**：删除 `ctx.overlays.define` 与 `fabric.overlay`，改为窄的 `ctx.hud.define` / `fabric.hud`；Popover / Dropdown 继续作为锚定组件。
- `Modal` 支持 `modal: false`，非模态 host 不截获宿主区域点击。

## 0.6.0

- **发布闸门**：`prepublishOnly` 跑完整 `verify`；`types:check` 新增手写声明编译探针并接入 verify。
- **完成 clean break**：`@dsh-do/fabric/sdk` 删除 `createJsonClient` / `FabricHttpError` / `createEventStream` / `createConfigStore` 等裸 wire API；ConfigStore 只接受 typed `ConfigResourceTransport`，配置冲突统一走 `config-conflict` 资源错误。JsonValue 移入 `src/sdk/json.ts`。
- **单例故障隔离**：Workbench 每个页面包 ErrorBoundary，单页崩溃显示 ErrorState 并可重试，不再拖垮整个 runtime；toolbar action 崩溃被静默隔离并打 console.error。
- **CI**：新增 GitHub Actions verify 流水线（test/build/example/client/pack/create/types 检查）。

## 0.5.2

- 遮罩改用 `--fabric-overlay-scrim`（映射 `--dsw-alias-bg-mask-1`），面板底色保留 `surface.overlay`，修复打开 Fabric 时全屏不透明遮挡。

## 0.5.1

- `dsh.client.immediately: true`：单例 factory 在任何下游 bundle 物化前登记，修复 `require("@dsh-do/fabric") missed the module table`。

## 0.5.0

- Clean break 单例架构：每 Profile 一份 `@dsh-do/fabric` runtime（adapter + registry + UI + 语义主题 + 基础 CSS）。
- 公共入口改为 `defineClientPlugin` / `defineHostPlugin`；Host/Client 数据边界只有 typed Resource。
- 主题公共层只暴露 `--fabric-*` 语义角色；`--dsw-*` 收进 DSH bridge。
- ModuleLoader id = `package.json.name`，runtime pluginId 自动剥 scope。
