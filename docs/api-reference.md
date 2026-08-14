# Fabric API 完整参考手册

Fabric 采用严格的模块化子路径导出（Subpath Exports），保证不同运行环境（Node 宿主、浏览器、构建脚本、工具链）的边界清晰。

---

## 1. 导出子路径总览

| 导入路径 | 运行环境 | 主要内容 | 依赖与打包约定 |
|---|---|---|---|
| `fabric` | Node 宿主 | 后端入口（注册 `/fabric/config` 持久化路由） | Cordis 插件，由 DSH 宿主加载 |
| `fabric/client` | 浏览器 | `ctx.fabric` 客户端服务接口、贡献类型与 Props 声明 | **只做类型导入** (`import type`) |
| `fabric/sdk` | 浏览器 / Node | HTTP 请求客户端、SSE 通道、异步状态模型、配置状态机 | 值导入，打入下游 bundle |
| `fabric/ui` | 浏览器 | 布局排版、模态弹窗、气泡、下拉菜单、状态组件与 Design Tokens | 值导入，打入下游 bundle |
| `fabric/build` | Node (构建时) | `tsdown` 插件构建预设与打包规则 | 仅用于 `tsdown.config.ts` |
| `fabric/create` | Node (工具链) | `create-fabric-plugin` 编程式脚手架生成函数 | 用于自动化脚本与 CLI |

---

## 2. `fabric/client`（客户端核心服务与贡献）

```ts
import type {
  FabricService,
  FabricPageProps,
  FabricToolbarActionProps,
  FabricOverlayProps,
  FabricSettingsProps,
  FabricContribution,
  FabricThemeService,
  FabricCommandService,
  FabricCapabilityService,
} from 'fabric/client'
```

### 2.1 `FabricService`（挂载在 `ctx.fabric`）
- `register(contribution: FabricContribution): () => void`：注册扩展贡献（归属于当前 Cordis fiber）。
- `open(pageId?: string): void`：打开工作台抽屉（可指定默认跳转页面）。
- `close(): void`：关闭工作台抽屉。
- `toggle(pageId?: string): void`：切换工作台抽屉显示状态。
- `navigate(pageId: string): void`：切换至指定工作台页面。
- `notify(message: string, options?: FabricNoticeOptions): () => void`：派发全局悬浮通知。
- `dismissNotice(id: string): void`：关闭指定通知。
- `readonly theme: FabricThemeService`：主题管理子服务。
- `readonly configs: FabricConfigRuntime`：配置目录子服务。
- `readonly commands: FabricCommandService`：命令与快捷键子服务。
- `readonly capabilities: FabricCapabilityService`：跨插件能力发现子服务。
- `registerConfig(definition): () => void`：注册持久化配置并自动注入设置页。
- `registerCapability<T>(id, implementation): () => void`：注册跨插件服务能力。
- `getCapability<T>(id): T | undefined`：获取指定跨插件服务能力。

### 2.2 八类 `FabricContribution` 判别联合
```ts
export type FabricContribution =
  | FabricPageContribution       // kind: 'page'
  | FabricToolbarContribution    // kind: 'toolbar'
  | FabricOverlayContribution    // kind: 'overlay'
  | FabricSettingsContribution   // kind: 'settings'
  | FabricThemeContribution      // kind: 'theme'
  | FabricModContribution        // kind: 'mod'
  | FabricConfigContribution     // kind: 'config'
  | FabricCommandContribution    // kind: 'command'
```

---

## 3. `fabric/sdk`（数据流与状态工具库）

```ts
import {
  createJsonClient,
  FabricHttpError,
  createAsyncResource,
  AsyncResource,
  createEventStream,
  EventStream,
  ConfigStore,
  createConfigStore,
  ObservableStore,
} from 'fabric/sdk'
```

### 3.1 同源 HTTP 客户端
- `createJsonClient(options?)`
  - `options.sessionId?: () => string | undefined`：动态提供会话 ID。
  - `options.baseUrl?: string`：API 根路径。
  - `client.get<T>(path, options?)` / `post<T>(path, body?, options?)` / `put` / `patch` / `delete`。
  - `options.session?: boolean`：设为 `false` 可显式剥离会话参数。

### 3.2 异步资源与 SSE 通道
- `createAsyncResource<T>(loader: (signal) => Promise<T>): AsyncResource<T>`
  - 具备 `load()`、`cancel()`、`set(value)`、`reset()` 方法。
  - 防竞态：始终保持最新发起的请求胜出（Latest-Request-Wins）。
- `createEventStream<T>(options): EventStream<T>`
  - 具备断线自动指数退避重连，连接建立后重置退避计数。

### 3.3 配置状态机 (`ConfigStore`)
- `createConfigStore<T>(options): ConfigStore<T>`
  - 具备脏字段追踪 (`dirtyKeys`)、版本控制 (`seq`) 与 409 自动仲裁。

---

## 4. `fabric/ui`（组件库与设计系统）

```ts
import {
  Page,
  PageHeader,
  Section,
  Portal,
  Modal,
  Popover,
  Dropdown,
  AsyncView,
  LoadingState,
  EmptyState,
  ErrorState,
  Badge,
  ToolbarButton,
  ConfigForm,
  useFabricConfig,
  useObservable,
  useAsyncResource,
  tokens,
  Z_INDEX,
} from 'fabric/ui'
```

### 4.1 核心 React Hooks
- `useObservable<T>(observable: Observable<T>): T`：响应式订阅任意可观察对象。
- `useAsyncResource<T>(resource, options?): AsyncResourceSnapshot<T>`：订阅异步资源状态。
- `useFabricConfig<T>(id, fallback?): ConfigHookResult<T>`：双向绑定配置引擎。

### 4.2 交互与浮层组件
- `<Portal container?>`
- `<Modal open onClose title? description? size? footer? closeOnEsc? closeOnOverlayClick?>`
- `<Popover open? onOpenChange? trigger content placement? closeOnClickOutside? closeOnEsc?>`
- `<Dropdown trigger items placement?>`

---

## 5. `fabric/build`（构建预设）

```ts
import { defineConfig } from 'tsdown'
import { fabricPlugin, fabricClient, FABRIC_CLIENT_EXTERNALS } from 'fabric/build'

export default defineConfig(fabricPlugin({
  id: 'my-plugin',          // DSH 插件唯一包名
  entry: 'src/client/index.ts', // 浏览器入口（默认 src/client/index.ts）
  hostEntry: 'src/index.ts',     // Node 宿主入口（默认 src/index.ts）
}))
```

---

## 6. `fabric/create`（脚手架 API）

```ts
import { scaffoldPlugin, parseCreateArgs, renderScaffold } from 'fabric/create'

// 执行脚手架生成
const files = await scaffoldPlugin({
  name: 'my-new-plugin',
  directory: './plugins/my-new-plugin',
})
```
