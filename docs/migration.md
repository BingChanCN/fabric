# 普通插件迁移

Fabric 提供一个有限的源码迁移器，把满足严格条件的普通 DSH 插件转换成独立 Runtime Package。它不会加载、执行或安装旧插件，也不会修改源目录。

## 命令

```sh
fabric migrate analyze D:/work/legacy-plugin
fabric migrate apply D:/work/legacy-plugin --out D:/work/legacy-plugin-runtime
```

`analyze` 是只读检查，输出 `portable`、`manual` 或 `blocked`，并给出文件、行号和原因。`apply` 只接受 `portable` 结果；目标目录必须不存在。生成后仍需在目标目录安装依赖并运行：

```sh
pnpm install
pnpm build
fabric verify
```

迁移器不会自动执行 `npm install`、生命周期脚本或旧插件代码。

## 自动范围

第一版只转换一个确定的浏览器贡献：

- `dsh.bundle.patch` 必须是只插入当前包自身的一条标准 Cordis patch。
- Host 入口只能是 `name`、`inject`、类型声明和空的 `apply` 壳。
- Client 入口只能导出一个 `apply(ctx)`，直接注册一次 `ctx.slots.inject('shell.overlay', ...)`。
- 注册配置只能包含 `name`、`id` 和可选数字 `order`。
- overlay 必须是本地 named import 的零 props React 函数组件。
- 组件和其本地依赖只能是源目录内的 `.ts/.tsx`，且不能导入 DSH 私有模块、Node builtin、动态 `import()`、`require()` 或 TypeScript `import = require()`。
- 源目录不得包含 legacy `.d.ts`；这类全局或路径声明必须人工重建。
- 样式只能是本地 `.module.css`，且不得包含 `url()`、`@import` 或跨文件 `composes ... from`。
- 普通 TypeScript/React 依赖会复制到生成包并由 Runtime 构建器打包；生成的 `tsconfig` 关闭 strict 以保留旧项目的隐式-any 兼容性；Fabric/React 依赖使用 Runtime 的公开边界。

生成结果把 `shell.overlay` 映射为 `fabric.hud`，保留原始包名和版本，删除旧 `dsh`/Cordis patch 元数据，并生成 `package.json.fabric`、Client entry 和构建配置。

## 人工迁移

以下情况会报告 `manual`，不会生成半成品：Host 服务调用、副作用 import、参数初始化或解构、Client entry 的额外顶层行为或 import、多个 slot 操作、Settings/Agent/Session 能力、复杂 React props、HTTP 路由、Credential、Document/Blob 语义、JavaScript/JSX、legacy `.d.ts`、`import = require()`、本地非 `.module.css` 样式、CSS `url()`/`@import`/跨文件 composition、二进制资源和动态模块加载。需要人工使用 Fabric Resource、Operation、Config、Document、Blob 或 Credential API 重写。

## 阻断

以下情况直接报告 `blocked`：Cordis patch 修改 profile 中其他内容、Client 导入 `@deepseek-ai/*` 或 Node builtin、局部依赖越出源目录、入口/组件文件无法解析，或 YAML/manifest 不合法。

已经发布的普通 DSH bundle 不能被 Fabric 安装器直接转译。它们仍按 DSH profile bundle 安装；迁移器的输入必须是本地可分析源码。
