# Fabric 文档中心

欢迎查阅 Fabric 前端框架（`fabric`）官方文档。Fabric 是面向 DeepSeek Harness (DSH) 生态的轻量级全栈 Modding 框架。

---

## 📚 文档导航索引

| 专题指南 | 核心内容 | 适用受众 |
|---|---|---|
| 🚀 **[插件开发快速上手 (Plugin Development)](plugin-development.md)** | 从零创建、开发、构建并安装一个完整的 DSH 插件 | 初学者 / 插件作者 |
| 🛠️ **[官方脚手架 CLI (create-fabric-plugin)](cli.md)** | 使用 `create-fabric-plugin` 一键生成标准插件骨架 | 快速启动新项目 |
| 🧩 **[UI 组件与设计系统 (Components & Design Tokens)](components.md)** | 布局、Modal 弹窗、Popover 气泡、Dropdown 下拉、异步视图与 Design Tokens | 前端界面开发 |
| ⚙️ **[声明式配置与状态同步 (Configuration & Sync)](configuration.md)** | Schema-Driven 表单引擎、脏字段保护、Seq 409 防竞态同步与 Host 文件持久化 | 全栈插件作者 |
| 🎨 **[主题系统与 Token 桥接 (Theming & Token Bridge)](theming.md)** | 高特异性 CSS 变量注入、优先级仲裁、暗色模式监听与主题切换 | 皮肤/主题开发者 |
| ⌨️ **[命令面板、快捷键与 Capability (Commands & Capabilities)](commands-and-capabilities.md)** | `Mod+K` 命令面板、跨平台快捷键、跨插件能力发现与解耦调用 | 深度生态集成 |
| 🏗️ **[框架架构与设计原理 (Architecture)](architecture.md)** | 槽位模型、Cordis Fiber 生命周期、Keep-Alive 机制与兼容边界 | 进阶开发者 / 贡献者 |
| 📖 **[API 完整参考手册 (API Reference)](api-reference.md)** | `fabric/*` 全导出类型、方法签名与 Props 字典 | 随时查阅与速查 |

---

## 📦 快速安装命令

```sh
# 1. 创建新插件
npx create-fabric-plugin my-plugin

# 2. 安装至 DSH Web Profile
dsh plugin --profile web add fabric
```
