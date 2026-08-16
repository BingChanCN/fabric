# Fabric 文档

Fabric 1.0 由两层组成：每个 DSH Profile 只静态加载一份 `@dsh-do/fabric` Core；生态插件是由 Core 托管、无需重启即可装卸的 Runtime Package。

| 专题 | 内容 |
|---|---|
| [插件开发](plugin-development.md) | Runtime manifest、Host/Client、Resource、构建 |
| [CLI](cli.md) | create/build/test/verify/dev/pack |
| [普通插件迁移](migration.md) | 严格源码迁移子集与诊断 |
| [组件](components.md) | UI 与 `--fabric-*` tokens |
| [Page action 与 Dialog](page-actions-and-dialogs.md) | action、badge、dialog scope 与 HUD |
| [配置](configuration.md) | typed Config |
| [主题](theming.md) | 语义主题 |
| [命令与 Capability](commands-and-capabilities.md) | 命令面板与跨插件协作 |
| [架构](architecture.md) | Core、Runtime lifecycle 与兼容边界 |
| [API](api-reference.md) | 公共入口与类型 |
