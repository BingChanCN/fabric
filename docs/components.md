# Fabric UI 组件与设计系统

Fabric 提供了轻量、无重依赖的 UI 组件库（`@dsh-do/fabric/ui`）。基础样式由单例 runtime 加载一次，组件只消费 `--fabric-*` 语义变量。

---

## 1. 语义 Design Tokens 与层级规范

### 1.1 语义 Token 映射（`tokens`）
通过 `import { tokens } from '@dsh-do/fabric/ui'` 引用语义角色。`--dsw-*` 不出现在公共组件层：

```ts
import { tokens } from '@dsh-do/fabric/ui'

const customStyle = {
  backgroundColor: tokens.bg.base,
  color: tokens.text.primary,
  borderColor: tokens.border.l2,
  fontFamily: tokens.font.family,
}
```

| Token 路径 | CSS 变量 | 典型用途 |
|---|---|---|
| `tokens.bg.base` | `--fabric-surface-base` | 页面主底 |
| `tokens.bg.subtle` | `--fabric-surface-muted` | 次级区域 |
| `tokens.bg.elevated` | `--fabric-surface-raised` | 弹窗/卡片 |
| `tokens.bg.overlay` | `--fabric-surface-overlay` | 遮罩 |
| `tokens.text.primary` | `--fabric-content-primary` | 正文 |
| `tokens.text.secondary` | `--fabric-content-secondary` | 说明 |
| `tokens.text.tertiary` | `--fabric-content-tertiary` | 弱化提示 |
| `tokens.border.l1` | `--fabric-border-subtle` | 细分割线 |
| `tokens.border.l2` | `--fabric-border-default` | 默认边框 |
| `tokens.border.l3` | `--fabric-border-strong` | 强调边框 |
| `tokens.brand.primary` | `--fabric-accent-primary` | 主操作 |
| `tokens.state.error` | `--fabric-state-danger-foreground` | 危险 |
| `tokens.state.success` | `--fabric-state-success-foreground` | 成功 |

### 1.2 `Z_INDEX` 层级规范
```ts
import { Z_INDEX } from '@dsh-do/fabric/ui'
```

- `Z_INDEX.BASE` (0): 普通内容流
- `Z_INDEX.STICKY` (10): 粘性吸顶标题、导航
- `Z_INDEX.DROPDOWN` (100): 下拉菜单
- `Z_INDEX.POPOVER` (200): 气泡卡片
- `Z_INDEX.DRAWER` (500): 侧滑抽屉
- `Z_INDEX.OVERLAY` (600): 全局扩展层
- `Z_INDEX.MODAL` (1000): 模态对话框
- `Z_INDEX.TOAST` (2000): 悬浮通知

---

## 2. 布局排版组件

### 2.1 `Page` 与 `PageHeader`
页面标准外壳与标题区，自带滚动容器与间距控制。

```tsx
import { Page, PageHeader, Badge, ToolbarButton } from '@dsh-do/fabric/ui'

export function MyPage() {
  return (
    <Page>
      <PageHeader
        title="任务中心"
        description="管理与查看异步任务执行进度"
        actions={
          <>
            <Badge tone="info">运行中 2</Badge>
            <ToolbarButton label="刷新" icon="🔄" onClick={() => {}} />
          </>
        }
      />
      {/* 页面正文 */}
    </Page>
  )
}
```

### 2.2 `Section`
内容分块卡片，支持标题、描述与右侧操作槽位。

```tsx
import { Section } from '@dsh-do/fabric/ui'

<Section
  title="网络与代理设置"
  description="配置外部 API 请求与转发规则"
  actions={<button type="button">重置</button>}
>
  <p>表单或表格内容...</p>
</Section>
```

---

## 3. 浮层与交互基建

### 3.1 `Portal`
将子节点挂载至 `document.body` 上的专用 `#fabric-portal-root` 容器中。

```tsx
import { Portal } from '@dsh-do/fabric/ui'

<Portal>
  <div style={{ position: 'fixed', bottom: 16, right: 16 }}>
    常驻悬浮小部件
  </div>
</Portal>
```

### 3.2 `Modal`（模态弹窗）
支持 ESC 关闭、遮罩点击、键盘焦点捕获及四种尺寸（`sm`, `md`, `lg`, `full`）。

```tsx
import { useState } from 'react'
import { Modal } from '@dsh-do/fabric/ui'

export function DeleteConfirmModal() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>删除记录</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="确认删除"
        description="此操作不可逆，请确认是否继续。"
        size="sm"
        closeOnEsc={true}
        closeOnOverlayClick={true}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)}>取消</button>
            <button type="button" data-danger onClick={() => { /* 执行删除 */ setOpen(false) }}>确认删除</button>
          </>
        }
      >
        <p>您即将删除当前所选的会话配置。</p>
      </Modal>
    </>
  )
}
```

### 3.3 `Popover` 与 `Dropdown`
基于极简绝对坐标计算与 Click-Outside 监听的浮动层，零外部重依赖。

```tsx
import { Popover, Dropdown } from '@dsh-do/fabric/ui'

// 1. 自定义气泡卡片
<Popover
  placement="bottom"
  trigger={<button>查看详情</button>}
  content={<div>气泡卡片详情内容</div>}
/>

// 2. 下拉菜单
<Dropdown
  placement="bottom"
  trigger={<button>更多操作 ▾</button>}
  items={[
    { id: 'edit', label: '编辑', icon: '✏️', onClick: () => console.log('edit') },
    { id: 'export', label: '导出 JSON', icon: '📥', onClick: () => console.log('export') },
    { id: 'delete', label: '删除', icon: '🗑️', danger: true, onClick: () => console.log('delete') },
  ]}
/>
```

---

## 4. 异步数据与状态视图

### 4.1 `AsyncView`
配合 `createAsyncResource` / `useAsyncResource` 使用，自动处理加载中、错误、空状态与正常渲染。

```tsx
import { createAsyncResource } from '@dsh-do/fabric/sdk'
import { AsyncView, useAsyncResource } from '@dsh-do/fabric/ui'

const taskResource = createAsyncResource(async (signal) => {
  const res = await fetch('/api/tasks', { signal })
  return (await res.json()) as string[]
})

export function TaskList() {
  const snapshot = useAsyncResource(taskResource)

  return (
    <AsyncView
      snapshot={snapshot}
      loadingLabel="正在加载任务列表..."
      empty="暂无待处理任务"
      isEmpty={(list) => list.length === 0}
      onRetry={() => taskResource.load()}
    >
      {(tasks) => (
        <ul>
          {tasks.map(task => <li key={task}>{task}</li>)}
        </ul>
      )}
    </AsyncView>
  )
}
```

### 4.2 `Badge`、`LoadingState`、`EmptyState`、`ErrorState`
原子化状态展示组件。

```tsx
import { Badge, LoadingState, EmptyState, ErrorState } from '@dsh-do/fabric/ui'

// 徽标状态
<Badge tone="success">已就绪</Badge>
<Badge tone="warning">待重试</Badge>
<Badge tone="error">连接失败</Badge>

// 空状态与错误提示
<EmptyState title="无可用会话" description="请先在 DSH 侧边栏创建或选择会话" />
<ErrorState error="请求超时，请检查后端服务" retry={() => taskResource.load()} />
```

---

## 5. 声明式配置表单

### 5.1 `useFabricConfig` & `ConfigForm`
直接绑定由 `ctx.config.define(...)` 得到的 handle：

```tsx
import { ConfigForm } from '@dsh-do/fabric/ui'

export function PluginSettings({ config }: { config: ReturnType<FabricClientPluginContext['config']['define']> }) {
  return <ConfigForm config={config} />
}
```
