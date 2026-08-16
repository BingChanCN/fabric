# Fabric

Fabric 是 DSH 的 Runtime Plugin 内核和下游 SDK。`@dsh-do/fabric` 是每个 Profile 唯一需要进入 DSH boot graph 的静态基础插件；业务插件由 Fabric 按 Profile 安装、启停、升级和卸载，安装后无需重启 DSH。

当前基线：Fabric `1.0.0`、`@deepseek-ai/dsh@0.1.0-rc.6`。

## 安装

先安装 Core，并完成这一次计划内重启：

```sh
dsh plugin --profile web add @dsh-do/fabric
```

此后在 Fabric 的 Mods 页面或 dsh-do 插件市场安装 Runtime Package，例如：

```text
hello-fabric
@dsh-do/fabric-theme-studio
file:D:/work/my-plugin
```

Runtime Package 不写入 DSH profile bundle，也没有 `cordis.patch.yml`。安装、升级、停用、回退和删除会同步到当前 Profile 的所有浏览器标签页。

## 创建插件

```sh
npx create-fabric-plugin @example/jobs
cd jobs
pnpm install
pnpm build
fabric verify
fabric dev --profile web
```

`fabric dev` 使用临时 overlay：成功构建会完整热换 Host 与每个标签页的 Client；构建或 Host 激活失败时保留上一个成功 generation；CLI 退出或连接断开后恢复已安装的 production 版本。它不会修改 `plugins.json` 或 current/previous 版本槽。

Runtime manifest 位于 `package.json`：

```json
{
  "name": "@example/jobs",
  "version": "1.0.0",
  "type": "module",
  "fabric": {
    "format": 1,
    "api": "^1.0.0",
    "host": "./lib/fabric-host.js",
    "client": "./lib/fabric-client.js",
    "contracts": "./lib/contracts.js"
  }
}
```

Host 或 Client 至少提供一个。普通依赖在构建时进入对应 bundle；Runtime 插件之间不做运行时 npm import，协作使用 Capability、Resource 或 Operation。

## 编程模型

- Host 默认导出 `defineHostPlugin(...)`，只接收窄的 Fabric Host Context。
- Client 默认导出 `defineClientPlugin(...)`，注册 Page、Dialog、Command、HUD、Config 和 Capability。
- Host/Client 数据交换只走带 `{ owner, id, exact version }` 身份的 typed Resource 或 Operation。
- Config、Document、Blob 存在当前 Profile 的 `.fabric/data/<canonical-package>/`；Credential 复用 DSH provider，Client 永远读不到明文。
- Runtime Package 是可信本机代码，不是安全沙箱。安装界面会显示来源、包名、版本和执行本机代码提示。

最小构建配置：

```ts
import { fabricRuntimePackage } from '@dsh-do/fabric/build'

export default fabricRuntimePackage()
```

## 作者命令

```sh
fabric create @example/jobs
fabric build
fabric test
fabric verify
fabric dev --profile web
fabric pack
```

`verify` 与 Core 安装器调用同一个 package validator。`pack` 先验证工作目录，执行真实 `npm pack`，再验证最终 tgz。

普通 DSH 插件可先用 `fabric migrate analyze <source>`、`fabric migrate analyze npm:<spec>` 或 `fabric migrate analyze file:<tgz>` 做只读迁移评估。真实 Runtime tgz 才能获得 `native-compatible`；只有严格的纯 `shell.overlay` 源码子集能在本地用 `fabric migrate apply <source> --out <target>` 自动生成 Runtime 包。复杂 Host/Client 行为必须人工迁移，已发布的 DSH bundle 不会被安装时转译。详见 [迁移普通插件](docs/migration.md)。

## 文档

| 专题 | 内容 |
|---|---|
| [插件开发](docs/plugin-development.md) | Runtime manifest、Host/Client、Resource 与构建 |
| [CLI](docs/cli.md) | create/build/test/verify/dev/pack |
| [普通插件迁移](docs/migration.md) | analyze/apply 的严格源码迁移子集与阻断条件 |
| [组件](docs/components.md) | Page、Modal 与 tokens |
| [Page action 与 Dialog](docs/page-actions-and-dialogs.md) | action、dialog scope 与 HUD |
| [配置](docs/configuration.md) | typed Config |
| [主题](docs/theming.md) | `--fabric-*` 语义主题 |
| [命令与 Capability](docs/commands-and-capabilities.md) | 命令面板与跨插件协作 |
| [架构](docs/architecture.md) | Core 单例、Runtime lifecycle 与边界 |
| [API](docs/api-reference.md) | 公共入口与类型 |

## 验证

```sh
pnpm verify
```

本地闸门覆盖单元/类型/构建、真实 tgz admission，以及干净 DSH Profile 中的 dsh-do 安装、双标签页热装卸、更新/回退、失败恢复、`fabric dev`、Theme Studio、Blob 和 DSH 重启恢复。Linux 与 Windows 的完整 release gate 可从 GitHub Actions 手动触发。
