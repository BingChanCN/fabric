# hello-fabric

这是 Fabric 的最小完整下游插件，包含：

- 一个 `fabric.page` 页面；
- 一个工作台工具栏动作；
- 一个 Plugins 设置贡献；
- 两个 DSH host 同源 JSON 路由；
- `createJsonClient`、`AsyncResource` 和 Fabric UI 组件；
- 由 `fabricPlugin()` 生成的 Node 与浏览器预构建产物。

在仓库根目录构建：

```sh
pnpm build
pnpm build:example
```

打包并安装到已经包含 Fabric 的 profile：

```sh
pnpm --dir examples/hello-fabric pack --pack-destination .pack-probe
dsh plugin --profile web add "D:/dsh-dev/fabric/.pack-probe/cortexkit-fabric-example-0.1.0.tgz"
dsh --profile web
```

本地安装使用 tarball；Windows 跨盘 `link:` 会受 pnpm 10.18.3 的坏链接问题影响。

打开侧栏中的 Fabric，选择 **Hello Fabric**。页面请求 `/fabric-example/status`，设置项写入 `/fabric-example/settings`；两条路由只保存当前进程内的示例状态。
