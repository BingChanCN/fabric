# Fabric 声明式配置引擎与状态同步

在开发全栈 DSH 插件时，配置管理往往涉及前端表单渲染、本地缓存、后端落盘持久化以及前后端并发更新竞态处理。Fabric 内置了声明式配置引擎（Schema-Driven Config Engine），插件作者只需声明配置 Schema，即可自动获得前后端双向同步、防竞态、防冲突以及自动渲染的表单界面。

---

## 1. 声明配置 Schema

在客户端 `apply(ctx)` 中通过 `ctx.fabric.registerConfig` 注册：

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export function apply(ctx: ClientContext): void {
  ctx.fabric.registerConfig({
    id: 'theme-studio',
    title: 'Theme Studio 设置',
    description: '控制调色板与主题自动同步选项',
    pluginId: 'fabric-theme-studio',
    schema: {
      autoFollowSystem: {
        type: 'boolean',
        title: '跟随系统外观',
        description: '根据系统暗色/亮色偏好自动切换主题',
        default: true,
      },
      defaultTheme: {
        type: 'select',
        title: '默认启动主题',
        options: [
          { label: 'DeepSeek Classic', value: 'classic' },
          { label: 'Nord Aurora', value: 'nord' },
          { label: 'Catppuccin Mocha', value: 'catppuccin' },
        ],
        default: 'classic',
      },
      syncIntervalMs: {
        type: 'number',
        title: '轮询同步间隔 (毫秒)',
        default: 5000,
        min: 1000,
        max: 60000,
        step: 1000,
      },
      customCss: {
        type: 'textarea',
        title: '自定义全局 CSS',
        description: '用户自定义覆盖规则',
        default: '',
        placeholder: '/* :root { ... } */',
      },
    },
  })
}
```

### 1.1 支持的字段类型

| 类型 (`type`) | UI 渲染形态 | 属性参数 |
|---|---|---|
| `boolean` | Switch 开关 / 复选框 | `title`, `description`, `default: boolean` |
| `string` | 单行输入框 (`input[type="text"]`) | `title`, `description`, `default: string`, `placeholder` |
| `textarea` | 多行文本域 (`textarea`) | `title`, `description`, `default: string`, `placeholder`, `rows` |
| `number` | 数字输入框 (`input[type="number"]`) | `title`, `description`, `default: number`, `min`, `max`, `step` |
| `select` | 下拉选择框 (`select`) | `title`, `description`, `default: string`, `options: Array<{ label, value }>` |

---

## 2. 状态机与防竞态同步模型

Fabric SDK 的 `ConfigStore` 实现了基于 **Dirty-Key 追踪** 与 **Seq 序列锁** 的状态机：

```
[ 用户编辑输入 ]
       │
       ▼
 1. 标记当前字段为 Dirty (本地值立即更新并派发 UI)
 2. 异步发起 PUT /fabric/config/:id (携带当前已知 seq)
       │
   ┌───┴───────────────────────────────┐
   ▼                                   ▼
 [ 成功 200 ]                       [ 冲突 409 Conflict ]
   • 更新服务端最新 seq                • 吸收服务端新 seq 与非 Dirty 字段
   • 清除已落盘字段的 Dirty 标记       • 重新发起包含本地 Dirty 字段的重试
```

### 核心保证：
1. **本地先行（Optimistic UI）**：用户输入时无需等待网络请求返回，界面即时响应。
2. **迟到 GET 不冲刷（Dirty Preservation）**：若用户正在输入，此时后端迟到的异步初始 GET 响应到达，**绝不会覆盖**任何本地处于 Dirty 状态的字段。
3. **409 自动仲裁与重试**：当多窗口或后台并发修改产生版本冲突时，客户端自动吸收远端无冲突字段，并带上最新 `seq` 重新投递用户的未保存修改。
4. **LocalStorage 预热**：优先从 `localStorage` 读取初始快照，避免首屏渲染闪烁。

---

## 3. 在 React 组件中读写配置

在插件页面或任意 UI 组件中，直接使用 `useFabricConfig`：

```tsx
import { useFabricConfig } from '@dsh-do/fabric/ui'

interface MyPluginConfig {
  autoFollowSystem: boolean
  defaultTheme: string
}

export function ThemeToolbar() {
  const config = useFabricConfig<MyPluginConfig>('theme-studio')

  const toggleAuto = () => {
    config.set({ autoFollowSystem: !config.values.autoFollowSystem })
  }

  return (
    <div>
      <span>当前模式：{config.values.autoFollowSystem ? '自动' : '手动'}</span>
      <button onClick={toggleAuto}>切换</button>
      {config.status === 'error' && <span>同步失败，重试中...</span>}
    </div>
  )
}
```

---

## 4. Host 端持久化与文件存储

Fabric 在 Node 宿主端注册了 `/fabric/config` 前缀路由，配置文档以 JSON 形式保存在用户的 DSH 配置目录中：

- **存储路径**：`$DSH_HOME/fabric/config/<id>.json`（默认 `~/.dsh/fabric/config/<id>.json`）
- **文件结构**：
  ```json
  {
    "id": "theme-studio",
    "seq": 4,
    "values": {
      "autoFollowSystem": true,
      "defaultTheme": "nord"
    },
    "updatedAt": 1741548800000
  }
  ```
- **安全边界**：内置 `isConfigId` 校验，禁止任何 `..` 路径穿越与非法字符写入。

---

## 5. 自动集成入口

声明式配置自动出现在两个一等入口：
1. **DSH 官方设置页**：`Settings -> Plugins -> Fabric` 标签页中自动按插件渲染。
2. **Fabric 内置 ModMenu**：工作台 ModMenu（`fabric:mods`）中点击任意插件的“配置”即可展开交互表单。
