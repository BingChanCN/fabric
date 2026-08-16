# Fabric 架构

Fabric 1.0 是 DSH 内的 Runtime Plugin 内核，不是 DSH API 的透传包装。

## 两层运行时

每个 Profile 的 DSH boot graph 只加载一份 `@dsh-do/fabric` Core。Core 拥有：

- profile-local package store 与 `plugins.json` desired state
- Host definition/Cordis fiber manager
- 每标签页 ModuleLoader reconciler
- Package Manager、Mods、Resource、Operation、Config、Document、Blob 与 Credential adapter
- DSH slot/token/theme bridge 和浏览器单例

生态 Runtime Package 不进入 DSH boot graph。Host 是预构建 ESM definition，Client 是登记稳定 ModuleLoader ID 的预构建单文件 factory；安装后由 Core 动态创建 fiber/entry。

## 身份

完整 `package.json.name` 是唯一 canonical package identity，npm scope 不删除。版本来自 `package.json.version`；每次激活由 Core 签发 generation，每个标签页有独立 clientInstanceId。Resource、Capability、Operation 使用 `{ owner, id, exact version }`。

插件可填写展示 descriptor，但不能覆盖真实 identity。

## 生命周期

激活遵循 Host-first：候选静态验证和 staging 完成后，先挂 Host；成功才提交 desired state并发布 Client snapshot。停用/更新遵循 Client-first：向在线标签页发布 retract generation，确认 entry/factory/CSS/effects 已撤销，再停 Host。

更新失败不会提交候选；旧 Host 和 current/previous 保持可用。单标签页 Client 失败只让该页 degraded，可单独 Retry，不触发全局回退。

## 持久状态

`<profile>/.fabric/` 包含：

```text
plugins.json
packages/<package>/<version>/
data/<package>/{config,documents,blobs}/
staging/
```

版本目录不可变。每包只保留 current + previous 两个成功版本。disable/remove 保留 data；purge 删除 Fabric-owned data。开发 overlay 位于临时 `dev/`，不写 `plugins.json`，lease 结束后恢复 production。

## 公共边界

Runtime Host 只拿窄 Fabric Context，Client 只拿 Fabric Client API。插件间没有 npm 运行时依赖图；同侧直接协作用 Capability，Client/Host 请求用 Resource，长任务用 Operation。Fabric 1.0 的这些契约仅支持 Profile scope。

Runtime Package 是可信本机代码，不是安全沙箱。Fabric 保证经其 Context 注册的 effects 可完整卸载，不声称限制 Host 的 Node 能力或 Client 的页面 JS 能力。
