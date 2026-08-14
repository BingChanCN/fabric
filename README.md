# Fabric

> **面向 DeepSeek Harness（DSH）生态的轻量级全栈 Modding 框架与组件系统**

Fabric 为 DSH 插件开发者提供统一的工作台入口、八大类扩展贡献注册、声明式配置引擎、高特异性主题桥接、命令面板与快捷键系统、跨插件能力发现以及官方脚手架 CLI。

当前兼容基线：`@deepseek-ai/dsh@0.1.0-rc.6`。

---

## ⚡ 快速开始

### 1. 一键创建新插件
```sh
npx create-fabric-plugin my-cool-plugin
cd my-cool-plugin
pnpm install
pnpm build
```

### 2. 安装 Fabric 框架至 DSH
从源码目录构建并安装本地 tarball（或直接安装发布包）：

```sh
# 本地打包与安装
pnpm --dir D:/dsh-dev/fabric pack --pack-destination .pack-probe
dsh plugin --profile web add "D:/dsh-dev/fabric/.pack-probe/fabric-0.4.0.tgz"

# 启动 DSH Web GUI
dsh --profile web
```

---

## 📖 官方文档体系

| 专题指南 | 核心内容 | 链接 |
|---|---|---|
| 🚀 **插件开发指南** | 从零手写或构建完整下游插件全流程 | [docs/plugin-development.md](docs/plugin-development.md) |
| 🛠️ **脚手架 CLI** | `create-fabric-plugin` 参数与模板结构 | [docs/cli.md](docs/cli.md) |
| 🧩 **UI 组件库与 Token** | 布局、Modal 弹窗、Popover 气泡、Dropdown 下拉、Design Tokens | [docs/components.md](docs/components.md) |
| ⚙️ **声明式配置与同步** | Schema 表单引擎、防竞态同步机制与 Host 文件持久化 | [docs/configuration.md](docs/configuration.md) |
| 🎨 **主题系统与 Token 桥接** | 高特异性选择器穿透、多主题优先级仲裁与暗色监听 | [docs/theming.md](docs/theming.md) |
| ⌨️ **命令、快捷键与能力** | `Mod+K` 命令面板、快捷键分发与跨插件 Capability | [docs/commands-and-capabilities.md](docs/commands-and-capabilities.md) |
| 🏗️ **架构与设计原理** | 槽位拓扑、Cordis Fiber 生命周期与 Keep-Alive 容器 | [docs/architecture.md](docs/architecture.md) |
| 📚 **API 参考手册** | 全模块导出类型、函数签名与 Props 字典 | [docs/api-reference.md](docs/api-reference.md) |

---

## ✨ 核心特性矩阵

### 1. 统一工作台与八类扩展贡献（`fabric/client`）
下游插件通过 `ctx.fabric.register(...)` 进行注册，所有注册项严格绑定至调用方 Cordis fiber 生命周期（支持 HMR 与卸载自动回滚）：

```ts
export const inject = ['fabric'] as const

export function apply(ctx: ClientContext): void {
  // 1. 工作台页面 (支持 keepAlive、icon、badge、pluginId)
  ctx.fabric.register({
    kind: 'page',
    id: 'activity',
    label: '动态监控',
    icon: '📊',
    badge: 3,
    keepAlive: true,
    pluginId: 'my-plugin',
    component: ActivityPage,
  })

  // 2. 标题栏动作
  ctx.fabric.register({ kind: 'toolbar', id: 'refresh', component: RefreshBtn })

  // 3. 全局扩展浮层
  ctx.fabric.register({ kind: 'overlay', id: 'hud', component: FloatingHud })

  // 4. 设置页插槽
  ctx.fabric.register({ kind: 'settings', id: 'my-settings', component: SettingsSection })

  // 5. 主题 Token 覆盖 (高特异性穿透宿主深色硬编码)
  ctx.fabric.register({
    kind: 'theme',
    id: 'nord-theme',
    priority: 10,
    tokens: { '--dsw-alias-bg-base': '#2e3440' },
  })

  // 6. ModMenu 身份卡
  ctx.fabric.register({
    kind: 'mod',
    id: 'my-plugin',
    name: 'My Cool Plugin',
    version: '0.4.0',
    description: 'Awesome DSH Mod',
  })

  // 7. 声明式配置文档
  ctx.fabric.registerConfig({
    id: 'my-plugin',
    title: 'Plugin Settings',
    schema: {
      autoSync: { type: 'boolean', title: '自动同步', default: true },
    },
  })

  // 8. 命令面板与全局快捷键
  ctx.fabric.register({
    kind: 'command',
    id: 'my-plugin.open',
    title: '打开监控面板',
    shortcut: 'Mod+Shift+M',
    handler: () => ctx.fabric.open('activity'),
  })
}
```

### 2. 声明式配置与防竞态同步（`fabric/ui` & `fabric/sdk`）
- 在组件中直接使用 `useFabricConfig`：
  ```tsx
  import { useFabricConfig } from 'fabric/ui'

  function MyComponent() {
    const config = useFabricConfig<{ autoSync: boolean }>('my-plugin')
    return (
      <button onClick={() => config.set({ autoSync: !config.values.autoSync })}>
        {config.values.autoSync ? '已开启' : '已关闭'}
      </button>
    )
  }
  ```
- **防竞态保证**：本地先行更新（Optimistic）、迟到 GET 绝不冲刷本地 Dirty 字段、Seq 版本并发锁、409 冲突自动重试。
- **Host 自动落盘**：文件自动写入 `$DSH_HOME/fabric/config/<id>.json`。

### 3. 跨插件能力发现（Capability Discovery）
跨插件无需 npm 强依赖即可解耦调用：
```ts
// 插件 A 暴露能力
ctx.fabric.registerCapability('task-runner', { runTask: (id) => true })

// 插件 B 消费能力
const runner = ctx.fabric.getCapability<{ runTask: (id: string) => boolean }>('task-runner')
runner?.runTask('task-1')
```

### 4. 丰富的基础交互与浮层基建（`fabric/ui`）
- `Modal` / `Dialog`（支持 ESC、遮罩点击、焦点捕获与 4 种尺寸）
- `Popover` / `Dropdown`（基于原生轻量计算与 Click-Outside 监听）
- `Portal`、`Page`、`PageHeader`、`Section`、`AsyncView`、`Badge`、`ToolbarButton`
- 规范化 `tokens.*` 与 `Z_INDEX.*` 常量

### 5. 一键构建预设（`fabric/build`）
```ts
import { defineConfig } from 'tsdown'
import { fabricPlugin } from 'fabric/build'

export default defineConfig(fabricPlugin({
  id: 'my-cool-plugin',
}))
```

---

## 🛠️ 工程化与质量保证

```sh
pnpm verify
```

全链回归流程包括：
- 严格 TypeScript 类型检查（开启 `exactOptionalPropertyTypes`）
- 14 个测试套件，45 条单元与生命周期测试
- Fabric host/client/sdk/ui/build/create 六组产物构建
- `hello-fabric` 真实示例插件编译
- 动态 ModuleLoader 闭包依赖校验
- npm tarball 契约检查
- `create-fabric-plugin` 生成与注入检查
- 独立临时 `DSH_HOME` 下真实 profile 安装、配置组装与 Web 服务启动 smoke

---

## 📄 开源许可证

[MIT License](LICENSE)
