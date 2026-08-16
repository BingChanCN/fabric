# Fabric CLI

## 创建

```sh
npx create-fabric-plugin my-plugin
npx create-fabric-plugin @example/my-plugin
# 已安装 @dsh-do/fabric 时也可用：
fabric create @example/my-plugin
```

脚手架生成 Fabric 1.0 Runtime Package：

- `package.json.fabric`，不生成 `dsh.bundle`、`dsh.client` 或 `cordis.patch.yml`
- `src/host.ts` 的 Host definition
- `src/client/index.tsx` 的 Client definition
- `fabricRuntimePackage()` 构建配置
- `@dsh-do/fabric` 仅作开发依赖

scoped 名创建短目录（`my-plugin`），但 canonical package identity 始终保留完整 `@scope/name`。

## 迁移普通插件

```sh
fabric migrate analyze D:/work/legacy-plugin
fabric migrate analyze npm:@scope/legacy-plugin@^1
fabric migrate analyze file:D:/downloads/legacy-plugin.tgz
fabric migrate apply D:/work/legacy-plugin --out D:/work/legacy-plugin-runtime
```

`analyze` 可读取本地源码、npm registry 包或本地 tgz，但永不执行 lifecycle script。npm range 会解析为实际 exact version，并从真实 tgz 判断 `native-compatible`、`native-incompatible`、`portable`、`manual`、`blocked`、`source-missing` 或 `not-dsh-plugin`；原生结论会重新走 Core admission validator。`apply` 始终只接受本地目录的严格纯 `shell.overlay` 子集，生成新的 Fabric HUD Runtime Package，不改源目录也不覆盖目标目录。复杂 Host 行为、DSH 私有模块、Settings/Agent/Session 能力、资源 URL 和已发布 tgz 不会被自动转换；Git URL 也不在支持范围。生成包仍需执行 `pnpm install && pnpm build && fabric verify`。

详细范围见 [普通插件迁移](migration.md)。

## 构建与测试

```sh
fabric build
fabric test
```

命令直接调用当前项目安装的 tsdown/vitest。构建产物约定为：

```text
lib/fabric-host.js
lib/fabric-client.js
lib/contracts.js
lib/contracts.d.ts
```

未声明 Host、Client 或 Contracts 时不生成对应产物。

## 验证与打包

```sh
fabric verify
fabric pack
```

`verify` 把已构建目录送入 Core 使用的同一个 admission validator。`pack` 先验证目录，执行真实 `npm pack`，再验证 tgz，成功后输出 tgz 路径。Core 的 `migrate:check` 闸门还会实际构建一个迁移 fixture 并重新走 admission。

## 开发热更新

```sh
fabric dev --profile web
fabric dev --profile sandbox --cwd D:/work/my-plugin --dsh-home D:/dsh-home
```

前提是目标 Profile 已启动 Fabric Core。CLI 首次构建成功后创建临时 lease；后续源码变化会生成单调 generation 并完整热换 Host/Client。失败构建或失败 Host 候选不会覆盖上一成功 generation。按 Ctrl+C、CLI 断开或 DSH 重启都会移除 overlay 并恢复 production；`plugins.json` 与 current/previous 槽不变。
