# hello-fabric

Fabric 1.0 的最小 Runtime Package：

- Host/Client definition，安装后无需重启
- Profile-scoped typed Resource
- Page、声明式 action、动态 badge、page-scoped 与非模态 dialog
- Config 派生设置页
- Command、Capability、HUD、keepAlive 页面状态
- 局部语义主题覆盖

```sh
pnpm --dir ../.. build
pnpm install
fabric build
fabric verify
fabric dev --profile web
```

正式安装时，在 Fabric Mods 中输入该目录的 `file:` 路径，或发布后输入 npm spec `hello-fabric`。该包不进入 DSH profile bundle，也不包含 `cordis.patch.yml`。
