# Fabric

> DSH 插件与 DeepSeek Harness 之间的兼容性隔离层。下游业务只依赖 Fabric 公共 API；DSH 破坏性变化由新版 Fabric 吸收。

当前兼容基线：`@deepseek-ai/dsh@0.1.0-rc.6`。本版本 **0.5.1** 是 clean break：每个 Profile 只加载一份 `@dsh-do/fabric` 单例 runtime。

---

## 快速开始

```sh
npx create-fabric-plugin my-plugin
# 或 scoped：
npx create-fabric-plugin @dsh-do/my-plugin
cd my-plugin
pnpm install
pnpm build
dsh plugin --profile web add "$(pwd)"
```

先安装 Fabric 自身：

```sh
dsh plugin --profile web add @dsh-do/fabric
```

---

## 公共编程模型

业务文件不接触 Cordis、`ClientContext`、`--dsw-*` 或 DSH slot。客户端导出一个定义，构建预设生成 bootstrap：

```tsx
import { defineClientPlugin } from '@dsh-do/fabric/client'
import { Page, PageHeader } from '@dsh-do/fabric/ui'

export default defineClientPlugin({
  descriptor: { name: 'Jobs' },
  setup(ctx) {
    const preferences = ctx.config.define({
      id: 'preferences',
      title: 'Jobs',
      schema: {
        pollMs: { type: 'number', title: 'Refresh interval', default: 4000, min: 500 },
      },
    })
    ctx.pages.define({
      id: 'home',
      label: 'Jobs',
      icon: '💼',
      keepAlive: true,
      config: [preferences],
      view: JobsPage,
      actions: [{ id: 'refresh', component: RefreshAction }],
    })
    ctx.commands.define({
      id: 'open',
      title: 'Open Jobs',
      shortcut: 'Mod+Shift+J',
      run: () => { ctx.open('home') },
    })
  },
})
```

Host 半部同样只见 Fabric：

```ts
import { defineHostPlugin, mountHostPlugin } from '@dsh-do/fabric'

const definition = defineHostPlugin({
  descriptor: { name: 'Jobs' },
  setup({ resources }) {
    resources.provide(jobsResource, {
      query: request => listJobs(request),
    })
  },
})

export const { inject, apply } = mountHostPlugin('@dsh-do/jobs', '0.1.0', definition)
```

---

## 文档

| 专题 | 内容 |
|---|---|
| [插件开发](docs/plugin-development.md) | define/setup、Page、构建与安装 |
| [脚手架](docs/cli.md) | `create-fabric-plugin` |
| [组件](docs/components.md) | Page / Modal / tokens |
| [配置](docs/configuration.md) | typed config handle + Resource 持久化 |
| [主题](docs/theming.md) | `--fabric-*` 语义主题 |
| [命令与 Capability](docs/commands-and-capabilities.md) | 命令面板与跨插件服务 |
| [架构](docs/architecture.md) | 单例 runtime 与兼容边界 |
| [API](docs/api-reference.md) | 公共类型 |

---

## 验证

```sh
pnpm verify
```

`verify` 覆盖类型检查、单元测试、Fabric 与 hello-fabric 构建、ModuleLoader 闭包、tarball 契约、脚手架和真实 DSH profile 安装。
