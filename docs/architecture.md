# Fabric 架构

Fabric 0.5.0 是 DSH 的兼容性隔离层，不是 DSH API 的透传包装。

## 单例 runtime

每个浏览器 Profile 只加载一份：

- ModuleLoader ABI：`@dsh-do/fabric`
- DSH adapter（slot / Cordis / `--dsw-*` 映射）
- 语义主题与基础 UI stylesheet
- command / config / capability / Resource dispatcher

下游插件 bundle 只保留业务页面、插件 CSS，以及对 `@dsh-do/fabric` 的 `require`。

DSH 的同步 `require` 不能去拉脚本。Fabric 必须声明 `dsh.client.immediately: true`，在任何下游 factory 物化前先登记 `__ModuleLoader__` factory。Fiber `inject` 等不到这一步。

## 身份

| 名字 | 来源 | 用途 |
|---|---|---|
| ModuleLoader id / `package.json.name` | 完整 npm 名 | 浏览器 factory 表 |
| runtime pluginId | 剥掉 scope 的短名 | 页面/资源/配置命名空间 |
| Cordis `inject` | 生成式 bootstrap | 客户端等 `fabric`，Host 等 `fabricHost` |

业务代码不再手填这三组名字。

## 三层上下文

- Profile runtime：每 Profile 一份，不持有业务状态
- Plugin scope：一次 `setup` 一个 `FabricClientPluginContext` / `FabricHostPluginContext`，注册、请求、流全部自动回收
- Session scope：必须显式传入，禁止隐式“当前 session”

Host 与 Client 只经 typed Resource 通信。

## 兼容承诺

下游业务源码只依赖 Fabric public API。DSH 改 slot 名、token、WebServer 或 UI primitive 时，升 Fabric 并重建即可，业务文件不改。

0.5.0 删除了 `ctx.fabric.register`、八类旧 contribution、旧 `--dsw-*` 公共 theme API、旧内联 UI 构建边界。旧 bundle 需要一次迁移重建。
