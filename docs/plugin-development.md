# Fabric 插件开发

本指南从一个空目录建立可安装的 Fabric 下游插件。示例基于 DSH `0.1.0-rc.6`、Fabric `0.1.0` 和 `tsdown 0.22.2`。

## 1. 包清单

下游插件是普通 DSH profile bundle。它对 Fabric 使用 peer dependency，并在开发时安装 Fabric、DSH 类型、React 和 tsdown。

```json
{
  "name": "my-fabric-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@cortexkit/fabric"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@cortexkit/fabric": "^0.1.0",
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@cortexkit/fabric": "^0.1.0",
    "tsdown": "0.22.2",
    "typescript": "~5.7.2"
  },
  "files": ["lib", "cordis.patch.yml"]
}
```

`dsh.client.inject` 必须列出客户端直接使用的 DSH 模块。若组件导入 `@deepseek-ai/dsh-client-ui-primitives`，也要把它加入 inject 和 peer/dev dependencies。`@cortexkit/fabric` 用于保证框架先于下游客户端激活。

## 2. Profile patch

`cordis.patch.yml` 把插件的 Node 入口加入 profile：

```yaml
- insert:
    - id: my-fabric-plugin
      name: my-fabric-plugin
```

即使插件没有 host 路由，也保留一个明确的空入口：

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(_ctx: Context): void {}
```

## 3. 注册页面

客户端入口只做 Fabric 类型导入；运行时服务来自 `ctx.fabric`。

```tsx
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { FabricPageProps } from '@cortexkit/fabric/client'
import { Page, PageHeader, Section } from '@cortexkit/fabric/ui'

export const inject = ['fabric'] as const

function JobsPage({ sessionId, notify }: FabricPageProps) {
  return (
    <Page>
      <PageHeader title="Jobs" />
      <Section title="Session">
        <button onClick={() => notify(sessionId ?? 'No session')}>Inspect</button>
      </Section>
    </Page>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.fabric.register({
    kind: 'page',
    id: 'jobs',
    order: 20,
    label: 'Jobs',
    component: JobsPage,
  })
}
```

`label` 可传字符串，也可传延迟求值函数。`id` 在同一种贡献类型内必须稳定；`order` 越小越靠前，省略时为 `0`。

其他贡献沿用同一入口：

```ts
ctx.fabric.register({ kind: 'toolbar', id: 'jobs-refresh', component: RefreshAction })
ctx.fabric.register({ kind: 'overlay', id: 'jobs-dialog', component: JobsDialog })
ctx.fabric.register({ kind: 'settings', id: 'jobs-settings', component: JobsSettings })
```

对应 props 类型为 `FabricToolbarActionProps`、`FabricOverlayProps`、`FabricSettingsProps`。不要直接注册 `fabric.*` DSH slot；`ctx.fabric.register()` 负责声明等待和调用方生命周期。

## 4. 同源数据

页面可从标准 props 读取当前会话，并让 JSON client 自动附加 query：

```ts
import { createJsonClient } from '@cortexkit/fabric/sdk'

const client = createJsonClient({ sessionId: () => sessionId })
const value = await client.get<{ count: number }>('/my-plugin/jobs')
```

全局 endpoint 显式关闭会话参数：

```ts
await client.post('/my-plugin/settings', { enabled: true }, { session: false })
```

Host 半部应通过 DSH 的 `webServer.register(...)` 提供同源路由。需要加载状态时使用 `createAsyncResource()`；需要推送时使用 `createEventStream()`。`@cortexkit/fabric/sdk` 和 `@cortexkit/fabric/ui` 是值导入，构建预设会把它们打入下游 bundle。

## 5. 构建

`tsdown.config.ts`：

```ts
import { defineConfig } from 'tsdown'
import { fabricPlugin } from '@cortexkit/fabric/build'

export default defineConfig(fabricPlugin({
  id: 'my-fabric-plugin',
}))
```

默认入口为 `src/index.ts` 和 `src/client/index.ts`，输出为 `lib/index.js`、`lib/client.js`。客户端产物已经包装为 DSH ModuleLoader 闭包，CSS Modules 会内联。

若插件只有客户端，可传 `hostEntry: false`。直接使用额外 DSH 浏览器模块时，把模块名同时加入 package manifest 的 `dsh.client.inject` 和构建选项 `external`。

以下运行时导入会被构建器拒绝：

```ts
import '@cortexkit/fabric'
import { apply } from '@cortexkit/fabric/client'
```

应改为 `import type`，并在运行时调用 `ctx.fabric`。这保证浏览器中只有一个 Fabric 服务。

## 6. 安装与验证

先安装 Fabric，再安装下游 bundle：

```sh
dsh plugin --profile web add @cortexkit/fabric
dsh plugin --profile web add ./my-fabric-plugin
dsh --profile web
```

本地 checkout 应先 `pnpm pack`，再把生成的 `.tgz` 绝对路径传给 `dsh plugin add`。Windows 上若 profile 与 checkout 位于不同盘符，pnpm 10.18.3 会为 `link:D:/...` 生成坏链接，因此跨盘目录 link 不属于受支持的安装路径。发布前至少执行严格类型检查、客户端构建和 tarball 安装，确认包内包含预构建 `lib/client.js` 与 patch，并能进入 `dsh.profile.bundles`。

仓库内的 `examples/hello-fabric` 额外演示了 host JSON 路由、页面异步状态、工具栏动作和设置贡献。
