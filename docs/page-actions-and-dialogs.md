# Page action、Dialog 与 HUD

## 声明式 action

普通 action 直接声明行为，不需要为一个按钮创建 React 组件：

```ts
const page = ctx.pages.define({
  id: 'jobs',
  label: 'Jobs',
  view: JobsPage,
  actions: [{
    id: 'refresh',
    label: 'Refresh',
    icon: '↻',
    tooltip: 'Refresh jobs',
    onClick: async ({ signal, notify }) => {
      const jobs = await loadJobs(signal)
      notify(`Loaded ${jobs.length} jobs`, { tone: 'success' })
    },
  }],
})

page.setBadge(4)
```

`onClick` 返回 Promise 时，Fabric 自动显示 pending 并禁止重复点击。抛出的错误会进入通知通道；切换页面或插件卸载会 abort `signal`。`tone: 'destructive'` 用于删除等破坏性操作，`hidden` 与 `disabled` 控制静态状态。

需要 Dropdown、Popover 或自定义状态时使用 `render`：

```ts
{ id: 'switcher', label: 'Switch view', render: ViewSwitcher }
```

`render` 与 `onClick` 互斥；同时声明或两者都缺失会立即报错。Page action 不进入全局命令面板，也不占全局快捷键。

## Dialog scope

插件级逻辑和命令使用 `ctx.dialogs`：

```ts
const handle = ctx.dialogs.open({
  id: 'about',
  title: 'About',
  content: AboutDialog,
})

handle.update({ title: 'About this plugin' })
handle.close()
```

页面组件使用 `page.dialogs`：

```tsx
function JobsPage({ page }: FabricPageProps) {
  return (
    <button onClick={() => page.dialogs.open({
      id: 'details',
      title: 'Job details',
      content: JobDetails,
      size: 'lg',
    })}>
      Open details
    </button>
  )
}
```

插件卸载会关闭该插件的全部 dialog；页面卸载会关闭该页拥有的 dialog。同一 scope 内再次打开同一 `id` 会替换原条目，不会重复堆叠。Esc 只关闭堆栈顶层。

`content` 可以是 ReactNode，也可以是接收 `{ dialog }` 的组件。后者可在内容内部调用 `dialog.close()` / `dialog.update()`。默认是模态 dialog；`modal: false` 适用于无需锚点但仍允许操作宿主的非模态窗口。锚定按钮的交互继续使用 `Popover` / `Dropdown` 组件，不走 dialog 服务。

## HUD

HUD 是常驻于 Workbench 抽屉外的非模态 UI，不是 dialog：

```ts
ctx.hud.define({
  id: 'status',
  component: StatusHud,
  config: [preferences],
})
```

HUD 组件只拿 `open`、`notify`、`dialogs` 和显式暴露的 config handle。它不能注册任意宿主 overlay，也不应承担页面导航之外的全局布局职责。
