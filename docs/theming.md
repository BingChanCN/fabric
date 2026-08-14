# Fabric 主题系统与 Token 桥接

在 DSH 生态中开发皮肤或主题时，最常见的阻碍是宿主样式的高特异性选择器覆盖。Fabric 提供了第一公民级别的主题系统（`ctx.fabric.theme`），统一管理 CSS 变量注入、特异性穿透、暗色模式监听与生命周期安全回滚。

---

## 1. 宿主特异性挑战与 Fabric 解决方案

### 1.1 痛点
DSH 宿主在 `design-platform.css` 中通过 `body[data-ds-dark-theme]` 硬编码了默认深色样式，并在运行时将 `active.tokens` 写为 `body` 的内联样式。普通下游插件若直接通过 CSS 类覆盖，极易在宿主切换主题或暗色模式时被硬编码选择器重新覆盖。

### 1.2 Fabric 的高特异性注入策略
Fabric 在 `<head>` 中维护唯一的 `<style id="fabric-theme-tokens">`，针对不同作用域生成穿透规则：

- **全局模式 (`scope: 'global'`)**：
  ```css
  :root, body, body[data-ds-dark-theme] {
    --dsw-alias-bg-base: #1e1e2e;
    --dsw-alias-label-primary: #cdd6f4;
  }
  ```
- **工作台模式 (`scope: 'workbench'`)**：
  ```css
  [data-fabric-workbench], [data-fabric-workbench] * {
    --dsw-alias-brand-primary: #a6e3a1;
  }
  ```

---

## 2. 注册与使用主题

### 2.1 声明式注册（推荐）
在插件入口通过 `ctx.fabric.register` 注册主题贡献，生命周期完全受控：

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'theme',
    id: 'catppuccin-mocha',
    pluginId: 'theme-studio',
    priority: 10,
    scope: 'global', // 'global' 或 'workbench'
    tokens: {
      '--dsw-alias-bg-base': '#1e1e2e',
      '--dsw-alias-bg-subtle': '#181825',
      '--dsw-alias-bg-elevated': '#313244',
      '--dsw-alias-label-primary': '#cdd6f4',
      '--dsw-alias-label-secondary': '#a6adc8',
      '--dsw-alias-border-l2': '#45475a',
      '--dsw-alias-brand-primary': '#89b4fa',
    },
  })
}
```

### 2.2 编程式调用（`ctx.fabric.theme`）
用于动态取色盘、临时微调或实时预览：

```ts
// 1. 设置临时 Token 覆盖（返回清理函数）
const unregister = ctx.fabric.theme.setTokens('preview-accent', {
  '--dsw-alias-brand-primary': '#f38ba8',
}, { priority: 100, scope: 'workbench' })

// 2. 移除指定 id 的覆盖
ctx.fabric.theme.clearTokens('preview-accent')

// 3. 读取当前已合并生效的 Token 快照
const activeTokens = ctx.fabric.theme.getTokens('global')
```

---

## 3. 多主题优先级仲裁机制

当多个插件注册了同名的 CSS 变量时，Fabric 按照以下规则合并：
1. **作用域分组**：`global` 与 `workbench` 分开独立计算。
2. **优先级排序**：按照 `priority` 数值升序排列（数值越大，优先级越高）。
3. **后到先得**：在相同 `priority` 下，后注册的 Token 覆盖先注册的。

---

## 4. 暗色模式响应（Dark Mode Observation）

Fabric 自动建立 `MutationObserver` 监听 `document.body` 上的 `data-ds-dark-theme` 属性变化，对外提供统一的广播与查询接口：

```ts
// 查询宿主当前是否为暗色
const isDark = ctx.fabric.theme.isDark()

// 订阅暗/亮色切换事件（返回取消订阅函数）
const stop = ctx.fabric.theme.onThemeChange(({ dark }) => {
  console.log('DSH 主题外观切换为:', dark ? '暗色 (Dark)' : '浅色 (Light)')
})
```

---

## 5. 生命周期与 HMR 安全

所有通过 `ctx.fabric.register({ kind: 'theme', ... })` 注入的样式均挂载在下游插件的 Cordis fiber 上。
- 当插件卸载、被禁用或发生 HMR 重载时，注入的 Token 规则会**自动移除并回滚**至上一个状态。
- 不会产生样式残留或 DOM 内存泄漏。
