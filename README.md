# Fabric

Fabric 是面向 DeepSeek Harness（DSH）客户端插件的组合式前端框架。它以一个 profile bundle 的形式安装，一次性接入 DSH 的稳定加法槽位，并向下游插件提供统一的工作台、贡献注册、状态通知、请求生命周期和构建约定。

当前兼容基线：`@deepseek-ai/dsh@0.1.0-rc.6`。

## 安装

从当前 checkout 构建 tarball，再把 tarball 安装到 Web profile：

```sh
pnpm install
pnpm build
pnpm pack --pack-destination .pack-probe
dsh plugin --profile web add "D:/dsh-dev/fabric/.pack-probe/fabric-0.3.0.tgz"
dsh --profile web
```

发布后直接安装包名：

```sh
dsh plugin --profile web add fabric
```

Fabric 的浏览器产物是预构建的 `lib/client.js`；DSH 不会现场编译 TypeScript 源码。tarball 直接传路径即可，不要加 `link:`/`file:` 前缀（`link:` 仅用于目录 checkout）。Windows 上不要用跨盘 `link:D:/...` 安装本地 checkout：pnpm 10.18.3 会在位于其他盘符的 profile 中生成坏链接。本项目的安装验收使用真实 tarball。

## 下游插件

下游客户端只通过 `ctx.fabric.register(...)` 注册贡献。组件类型从 `fabric/client` 做类型导入；运行时不要导入 Fabric 主入口或客户端入口。

```tsx
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { FabricPageProps } from 'fabric/client'
import { Page, PageHeader } from 'fabric/ui'

export const inject = ['fabric'] as const

function ActivityPage(_props: FabricPageProps) {
  return (
    <Page>
      <PageHeader title="Activity" />
    </Page>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'page',
    id: 'activity',
    label: 'Activity',
    component: ActivityPage,
  })
}
```

`register()` 接受七类贡献：

| `kind` | 渲染位置 / 作用域 | 说明 / Props |
|---|---|---|
| `page` | Fabric 工作台页面 | `FabricPageProps`，支持 `icon`、`badge`、`keepAlive`、`pluginId` |
| `toolbar` | 工作台标题栏动作 | `FabricToolbarActionProps` |
| `overlay` | DSH shell 上方的全局扩展层 | `FabricOverlayProps` |
| `settings` | DSH Plugins 设置页中的 Fabric 区域 | `FabricSettingsProps` |
| `theme` | 全局 / 工作台 CSS 变量覆盖 | 高特异性 Token 注入，支持 `priority` 冲突仲裁与暗色响应 |
| `mod` | 内置 ModMenu 身份卡 | 名称、版本、描述、图标 |
| `config` | 声明式配置文档 | schema 自动生成表单，经 `/fabric/config/:id` 持久化 |

也可用 `ctx.fabric.registerConfig({ id, title, schema })`。`useFabricConfig(id)` 读取同一份 store：本地先改、GET 不覆盖脏字段、PUT 带 seq，409 时保留本地编辑并重试。

注册项归属于调用它的下游 Cordis fiber。插件卸载或 HMR 时，对应贡献会自动释放；Fabric 不维护第二套组件注册表。

## 主题与 Token 桥接

```ts
// 注册主题 Token 覆盖（最高特异性注入，跟随宿主暗色切换，卸载自动回滚）
ctx.fabric.register({
  kind: 'theme',
  id: 'my-theme',
  priority: 10,
  tokens: {
    '--dsw-alias-bg-base': '#1e1e2e',
    '--dsw-alias-label-primary': '#cdd6f4',
  },
})

// 或直接通过服务调用
ctx.fabric.theme.setTokens('quick-accent', { '--dsw-brand-primary': '#a6e3a1' })
```

## 工具包

- `fabric/client`：`ctx.fabric`、`ctx.fabric.theme`、贡献对象和组件 props 类型。
- `fabric/sdk`：会话感知 JSON client、可取消的 latest-request-wins 资源、自动重连 SSE、带 seq 的 `ConfigStore`。
- `fabric/ui`：页面排版、`Modal`、`Popover`、`Dropdown`、`Portal`、`ConfigForm`、`useFabricConfig`、异步状态、徽标、语义 `tokens` 与 `Z_INDEX` 规范。
- `fabric/build`：生成 DSH ModuleLoader 客户端闭包的 `tsdown` 预设，并内联 CSS Modules。

完整开发流程见 [插件开发指南](docs/plugin-development.md)，边界与生命周期见 [架构说明](docs/architecture.md)。仓库中的 [hello-fabric](examples/hello-fabric) 是可构建、可安装的最小完整示例。

## 验证

```sh
pnpm verify
```

该命令执行严格 TypeScript 检查、单元与生命周期测试、Fabric 和示例构建、客户端闭包动态执行、真实 tarball 契约检查，以及隔离 `DSH_HOME` 中的 profile 安装与组装 smoke。

## License

MIT
