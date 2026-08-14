# Fabric 命令面板、快捷键与跨插件能力

Fabric 提供了统一的命令面板（Command Palette）、跨平台全局快捷键分发器以及跨插件服务发现机制（Capability Registry），帮助插件实现深度的生态互通与高效率键盘操作。

---

## 1. 命令注册与命令面板

### 1.1 注册命令
下游插件通过 `kind: 'command'` 注册动作：

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'command',
    id: 'theme.toggle-hud',
    title: '打开快速调色 HUD',
    description: '在屏幕顶部呼出浮动主题微调条',
    shortcut: 'Mod+Shift+T',
    pluginId: 'fabric-theme-studio',
    order: 10,
    handler: () => {
      // 执行动作
      ctx.fabric.notify('HUD 已开启', { tone: 'info' })
    },
  })
}
```

### 1.2 命令面板交互
- 按 **`Mod+K`**（Windows/Linux 上为 `Ctrl+K`，macOS 上为 `⌘K`）呼出全局命令面板。
- 支持实时模糊搜索（匹配命令 `title`、`id` 与 `description`）。
- 支持 `↑` / `↓` 键盘导航、`Enter` 执行与 `ESC` 退出。

### 1.3 快捷键规范与跨平台归一化
快捷键支持组合修饰键，Fabric 自动处理平台差异：

| 快捷键声明 | Windows / Linux 行为 | macOS 行为 |
|---|---|---|
| `Mod+K` | `Ctrl + K` | `⌘ + K` |
| `Mod+Shift+P` | `Ctrl + Shift + P` | `⌘ + ⇧ + P` |
| `Alt+T` | `Alt + T` | `⌥ + T` |
| `Ctrl+Enter` | `Ctrl + Enter` | `Ctrl + Enter` |

**输入框保护机制**：当用户的焦点处于 `<input>`、`<textarea>` 或 `contenteditable` 元素内时，单纯字母按键不会触发快捷键，仅带 `Ctrl` / `⌘` 的全局修饰组合生效，防止用户正常打字时误触命令。

### 1.4 内置系统命令

| 命令 ID | 默认快捷键 | 动作 |
|---|---|---|
| `fabric.palette` | `Mod+K` | 打开/关闭命令面板 |
| `fabric.open` | `Mod+Shift+F` | 打开 Fabric 主工作台 |
| `fabric.mods` | - | 打开 ModMenu 插件管理总览页 |
| `fabric.close` | - | 关闭 Fabric 主工作台 |

---

## 2. 跨插件服务发现（Capability Registry）

### 2.1 为什么需要 Capability？
在微内核插件架构中，插件 A 往往需要调用插件 B 暴露的能力（例如：调用 `theme-studio` 的配色接口、调用 `linter` 的检查函数）。如果通过 npm 建立强依赖，会导致版本死锁与打包膨胀。

Fabric 提供了轻量级的命名能力表（`CapabilityRegistry`），实现解耦的接口发现。

### 2.2 服务提供方（Provider）
提供方注册命名接口：

```ts
// 插件 A：导出主题能力的实现
interface ThemeProviderCapability {
  getCurrentThemeId(): string
  applyPreset(name: string): boolean
}

export function apply(ctx: ClientContext): void {
  ctx.fabric.registerCapability<ThemeProviderCapability>('theme-provider', {
    getCurrentThemeId: () => 'catppuccin',
    applyPreset: (name) => {
      console.log('应用预设:', name)
      return true
    },
  })
}
```

### 2.3 服务消费方（Consumer）
消费方无需 import 提供方的 npm 代码，按约定的 TypeScript interface 获取：

```ts
// 插件 B：消费主题能力
interface ThemeProviderCapability {
  getCurrentThemeId(): string
  applyPreset(name: string): boolean
}

export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'command',
    id: 'my-plugin.sync-theme',
    title: '同步当前主题颜色',
    handler: () => {
      const themeApi = ctx.fabric.getCapability<ThemeProviderCapability>('theme-provider')
      if (!themeApi) {
        ctx.fabric.notify('未检测到 Theme Provider 插件', { tone: 'warning' })
        return
      }
      const active = themeApi.getCurrentThemeId()
      ctx.fabric.notify(`当前主题为: ${active}`, { tone: 'success' })
    },
  })
}
```

### 2.4 生命周期安全
所有通过 `ctx.fabric.registerCapability` 注册的服务均绑定至提供方 Cordis fiber。
- 当提供方插件卸载或重载时，注册的 Capability 会自动注销。
- 消费方调用 `getCapability` 将安全返回 `undefined`，不会导致系统崩溃。
