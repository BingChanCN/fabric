# Fabric Runtime Plugin 开发

基线：Fabric `1.0.0`、DSH `0.1.0-rc.6`、Node 22、tsdown `0.22.2`。

```sh
npx create-fabric-plugin @example/jobs
```

## 1. Runtime manifest

```json
{
  "name": "@example/jobs",
  "version": "1.0.0",
  "type": "module",
  "fabric": {
    "format": 1,
    "api": "^1.0.0",
    "host": "./lib/fabric-host.js",
    "client": "./lib/fabric-client.js",
    "contracts": "./lib/contracts.js"
  },
  "devDependencies": {
    "@dsh-do/fabric": "^1.0.0"
  }
}
```

`name` 是不可缩写的 canonical identity；`@alice/weather` 与 `@bob/weather` 是两个包。Runtime Package 不包含 DSH bundle/client 清单或 Cordis patch。Host/Client 至少声明一个。

## 2. 共享契约

契约 token 使用完整 owner 和 exact contract version：

```ts
import { defineResource, jsonCodec } from '@dsh-do/fabric/contracts'

export const jobsResource = defineResource({
  owner: '@example/jobs',
  id: 'jobs',
  version: '1',
  scope: 'profile',
  request: jsonCodec,
  response: jsonCodec,
})
```

`./contracts` 只能导出 codec、token、类型和普通常量。消费者可在开发时 import 该子路径；构建器会把 token 编入 bundle，运行时不会加载 provider npm 包，也不会形成插件依赖图。

Fabric 1.0 的 Resource、Capability、Operation 都只有 Profile scope。

## 3. Host definition

```ts
import { defineHostPlugin } from '@dsh-do/fabric/host'
import { jobsResource } from './contracts.js'

export default defineHostPlugin({
  descriptor: { name: 'Jobs' },
  setup(ctx) {
    ctx.resources.provide(jobsResource, {
      query: async request => listJobs(request),
    })
  },
})
```

插件只拿 Fabric Host Context，不拿 Cordis Context、webServer、DSH 私有 service 或 profile 修改能力。可用 lifecycle、Resource、Operation、Document、Blob 和显式声明的 Credential。Host setup 可异步；只有 setup 完成后候选才会提交到 desired state。

## 4. Client definition

```tsx
import { defineClientPlugin } from '@dsh-do/fabric/client'
import { Page, PageHeader } from '@dsh-do/fabric/ui'

function JobsPage() {
  return <Page><PageHeader title="Jobs" /></Page>
}

export default defineClientPlugin({
  descriptor: { name: 'Jobs' },
  setup(ctx) {
    ctx.pages.define({ id: 'home', label: 'Jobs', keepAlive: true, view: JobsPage })
    ctx.commands.define({
      id: 'open',
      title: 'Open Jobs',
      shortcut: 'Mod+Shift+J',
      run: () => { ctx.open('home') },
    })
  },
})
```

页面、Dialog、Command、HUD、Config、Capability、Resource 请求和 CSS 都归当前 package generation。停用或更新时 Fabric 先撤销每个标签页的 Client effects，再释放 Host fiber。单个标签页 Client 失败只让该页 degraded，可在 Mods 中 Retry。

## 5. 数据

- Config：schema 驱动，Settings 自动投影，revision/CAS 写入。
- Document：Host-only typed document；Client 数据仍由 Resource 暴露。
- Blob：opaque owner-bound ref 与同源 URL，不暴露文件路径。
- Credential：适配 DSH provider；Client 只有 describe/set/unset，Host 每次操作重新 resolve。

Config、Document、Blob 位于当前 Profile 的 `.fabric/data/<encoded-package>/`。disable/remove 保留数据；purge 删除 Fabric-owned 数据，但不删除 DSH Credential、DSH Settings 或外部系统状态。

## 6. 构建与发布

```ts
import { fabricRuntimePackage } from '@dsh-do/fabric/build'

export default fabricRuntimePackage()
```

```sh
fabric build
fabric test
fabric verify
fabric dev --profile web
fabric pack
```

Host/Client 是单文件预构建产物。普通依赖打入 bundle；Client 外部只允许 Fabric 浏览器单例、React 和 JSX runtime，Host 不允许复制 Fabric Core runtime。`fabric verify` 与 Core 安装器共用 validator；`fabric pack` 还会验证最终 npm tgz。
