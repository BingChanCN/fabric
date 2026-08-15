# Fabric 插件开发

基线：DSH `0.1.0-rc.6`、Fabric `0.5.0`、`tsdown 0.22.2`。

最快路径：

```sh
npx create-fabric-plugin my-plugin
```

## 1. 包清单

`name` 必须等于 ModuleLoader id。`dsh.client.inject` 只声明 `@dsh-do/fabric`；构建预设会把 `@dsh-do/fabric/ui` 等子路径改写到这个单例模块。

```json
{
  "name": "my-fabric-plugin",
  "type": "module",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@dsh-do/fabric"], "platform": "web" },
    "dependencies": { "@dsh-do/fabric": "^0.5.0" }
  },
  "peerDependencies": { "@dsh-do/fabric": "^0.5.0", "react": "^18.2.0" }
}
```

scoped 包把 `name` 写成 `@dsh-do/jobs`。运行时 pluginId 自动剥 scope，变成 `jobs`。

## 2. Profile patch

```yaml
- insert:
    - id: my-fabric-plugin
      name: my-fabric-plugin
```

`id` 用短运行时名，`name` 用完整 npm 包名。

## 3. 客户端定义

业务文件导出 `defineClientPlugin`。不要手写 `inject` / `apply`，不要接收 `ClientContext`。

```tsx
import { defineClientPlugin } from '@dsh-do/fabric/client'
import { Page, PageHeader, Section } from '@dsh-do/fabric/ui'

function JobsPage({ page }: { page: { notify(message: string): void } }) {
  return (
    <Page>
      <PageHeader title="Jobs" />
      <Section title="Session">
        <button onClick={() => page.notify('ok')}>Inspect</button>
      </Section>
    </Page>
  )
}

export default defineClientPlugin({
  descriptor: { name: 'Jobs' },
  setup(ctx) {
    ctx.pages.define({
      id: 'home',
      label: 'Jobs',
      icon: '💼',
      keepAlive: true,
      view: JobsPage,
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

页面局部 id 由 Fabric 自动加上 plugin 命名空间。页面 action 写在 `pages.define({ actions })` 里，不再单独注册 toolbar。设置页由 `ctx.config.define({ settings })` 派生。

## 4. Host 与 Resource

Host/Client 之间只走 typed Resource，不要再向 `webServer` 挂 `/api`。

```ts
import { defineHostPlugin, mountHostPlugin, defineResource, jsonCodec } from '@dsh-do/fabric'

export const jobsResource = defineResource({
  id: 'jobs',
  version: '1',
  scope: 'session',
  request: jsonCodec,
  response: jsonCodec,
})

const definition = defineHostPlugin({
  descriptor: { name: 'Jobs' },
  setup({ resources }) {
    resources.provide(jobsResource, {
      query: (_request, context) => ({ sessionId: context.session?.id }),
    })
  },
})

export const { inject, apply } = mountHostPlugin('my-fabric-plugin', '0.1.0', definition)
```

客户端用 `page.resources.read(jobsResource, request, { session })`。`session` 作用域的资源必须显式传入 session，缺了会立刻失败。

## 5. 构建

```ts
import { defineConfig } from 'tsdown'
import { fabricPlugin } from '@dsh-do/fabric/build'

export default defineConfig(fabricPlugin({
  id: 'my-fabric-plugin',
}))
```

`id` 必须等于 `package.json` 的 `name`。下游 bundle 只含业务代码和插件自己的 CSS；Fabric UI / runtime / 基础样式来自单例 `@dsh-do/fabric`。
