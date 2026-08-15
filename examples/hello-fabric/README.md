# hello-fabric

Fabric 0.5 的最小下游插件：

- `defineClientPlugin` + `defineHostPlugin`
- 一个 session 作用域 Page，带 page action
- `ctx.config.define` 派生设置页
- 一条全局 command（`Mod+Shift+H`）
- 一个 typed capability
- 局部语义主题覆盖
- Host/Client 走 typed Resource，不再挂 `/fabric-example/*`

```sh
pnpm --dir ../.. build
pnpm build
dsh plugin --profile web add "$(pwd)"
```
