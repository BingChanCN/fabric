# Fabric 架构

## 定位

Fabric 是 DSH 客户端的基础插件与下游 SDK，不是新的渲染协议。DSH 的 `ui-slots` 继续负责组件声明、作用域、错误隔离、渲染和 HMR；Fabric 只在其上提供稳定的产品表面与开发约定。

目标：

- 下游插件无需理解 DSH 宿主槽位的声明顺序。
- 多个插件共享一个可导航工作台、设置区域、覆盖层和通知栈。
- 下游注册项严格跟随自己的 Cordis fiber 生命周期。
- 网络、异步状态和构建产物采用一致的最小契约。

非目标：

- 不替换 DSH root 或任何 single 槽。
- 不包装 Host 私有服务或 Remote RPC。
- 不复制会话状态，不建立第二个组件注册表。
- 不在浏览器运行时动态编译插件源码。

## 宿主接入

Fabric 只注册三个 DSH list 槽贡献：

| 宿主槽 | Fabric 贡献 | 职责 |
|---|---|---|
| `sidebar.footer.action` | 启动器 | 打开工作台 |
| `shell.overlay` | Workbench | 抽屉、页面路由、工具栏、覆盖层、通知 |
| `settings.plugins.tab` | Settings host | 渲染下游设置贡献 |

Workbench 声明三个子槽：`fabric.page`、`fabric.toolbar.action`、`fabric.overlay`。Settings host 声明 `fabric.settings`。四者均为 list 槽；页面用 DSH 原生 `renderSlot(..., { only: id })` 选择当前贡献。

工作台容器在首次打开后常驻保持 DOM 挂载，抽屉关闭时仅做 CSS 隐藏；已访问页面默认 `keepAlive: true` 保持挂载（`hidden` 切换可见性）。这样即使关闭并重新打开工作台抽屉，富表单草稿和局部状态仍旧保留。当页面显式声明 `keepAlive: false` 时，切走即销毁。贡献卸载后，对应页面会从已访问集合中移除。

## 服务与生命周期

浏览器入口同步构造 `FabricRuntimeService`，它作为 Cordis `Service` 暴露为 `ctx.fabric`。控制器维护不可变快照，同时内建 `FabricThemeManager` 提供 `ctx.fabric.theme` 主题服务：

- 工作台开关状态；
- 当前页面与 slot ledger 派生的页面目录（含 `icon`、`badge`、`keepAlive`、`pluginId` 元数据）；
- 通知队列；
- 全局与工作台级 CSS Token 高特异性注入（`:root, body, body[data-ds-dark-theme]`）；
- 多插件主题优先级仲裁与宿主暗色模式监听；
- schema 配置目录、Mod 身份卡与内置 ModMenu 页面；
- 命令面板、全局快捷键与跨插件 Capability 表；
- 单调递增 revision。

`ctx.fabric.register(contribution)` 对 UI 贡献是 DSH `slots.inject/register` 的薄委托；对 `command` / `mod` / `config` / `theme` 则写入 Fabric 自己的目录。Cordis service proxy 会把方法的 `this.ctx` 替换为调用方上下文，因此注册 effect 属于下游插件 fiber，而不是 Fabric 自身。两种卸载路径都成立：

1. 子槽已声明时，调用方卸载立即移除 ledger 条目。
2. 子槽尚未声明时，调用方卸载会取消等待，后续声明子槽不会复活该贡献。

Fabric 的单元测试使用真实 Cordis `Service` 和 DSH rc.6 发布的 `SlotRegistry` 覆盖这两个路径。

## 会话与状态

`fabric.page`、`fabric.toolbar.action` 和 `fabric.overlay` 使用 `session-maybe` scope，组件直接收到 DSH 标准 props（包括可用时的 `sessionId`）。Fabric 不镜像会话对象。

`fabric.settings` 使用 root scope。设置组件得到 `openFabric()` 和 `notify()`，但不隐式绑定某个会话。

页面目录由 `fabric.page` ledger 和 locale revision 共同驱动。插件热装卸或语言切换会更新目录；当前页面消失时控制器回退到排序后的第一个可用页面。

## SDK

`createJsonClient()` 只处理同源 HTTP：可选地把当前 `sessionId` 写入 query，编码 JSON body，解码响应，并把非 2xx 结果转成 `FabricHttpError`。

`AsyncResource` 提供可取消、latest-request-wins 的加载状态；过期响应不能覆盖新请求。`EventStream` 包装标准 `EventSource`，使用有界指数退避，并在成功连接后重置退避级别。

`ConfigStore` 是配置文档的客户端状态机：先写本地、标记脏字段，远程 GET 不得覆盖脏字段；PUT 携带 `seq`，409 时吸收服务端 seq 并保留本地编辑后重试。可选 `localStorage` 缓存避免首屏闪默认值。

这些库不依赖 Cordis 或 DSH 私有对象，可以打入下游客户端 bundle。

## 构建与分发

Fabric 是带 `dsh.bundle.patch` 的 profile bundle。Node 入口注册 `/fabric/config` 前缀路由，把配置文档持久化到 `$DSH_HOME/fabric/config/<id>.json`。客户端能力位于预构建的 `lib/client.js`。

`fabric/build` 生成 DSH 要求的 `window.__ModuleLoader__.load(...)` 闭包：

- React、Cordis 和 DSH 模块保持 external，由宿主模块表提供；
- `fabric/sdk` 与 `fabric/ui` 打入下游 bundle；
- 对 `fabric` 或 `fabric/client` 的运行时导入直接报错，防止复制框架服务；
- CSS Modules 经 Lightning CSS 编译并以内联 style 标签按插件 ID 更新。

公开声明手写存放在 `types/`。`pnpm verify` 同时用下游示例编译和 tarball 契约检查约束声明与产物。

## 兼容边界

Fabric 当前只承诺 DSH rc.6 的公开接口：`dsh.client` 预构建入口、Cordis `apply/inject/Service`、`ctx.slots.inject/register`、标准 slot props 和主题 token。Host 私有 API、root/single 槽和构建期 Remote 注册不属于兼容面。
