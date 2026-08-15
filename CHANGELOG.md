# Changelog

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
