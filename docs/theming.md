# 主题

公共层只认识 `--fabric-*` 语义角色。`--dsw-*` 只出现在 Fabric 的 DSH bridge 和官方主题 provider 内部。

## 语义角色

- surface：`base` / `raised` / `sunken` / `muted` / `overlay`
- content：`primary` / `secondary` / `tertiary` / `disabled` / `inverse`
- border：`subtle` / `default` / `strong` / `focus`
- accent：`primary` / `hover` / `active` / `surface`
- state：`info` / `success` / `warning` / `danger`，各含 `foreground` / `surface` / `border`
- interaction：`hover` / `active` / `selected` / `focus`
- material：acrylic / edge / shadow

状态色禁止把 foreground 和 surface 写成同一个值。组件只消费这些角色。

## 官方 Theme Provider

全局主题由一个 provider 写入，通常是 `fabric-theme-studio`：

```ts
ctx.theme.provide('theme', toFabricTheme(definition), { priority: 100, scope: 'global' })
```

普通插件只能做局部覆盖，不能改全局 token、不能抢更高 priority 去替换宿主。没有 theme-studio 时，Fabric runtime 自己写入一套安全默认主题。

## CSS

基础样式由单例 runtime 加载一次。下游 CSS 使用 `var(--fabric-content-primary)` 等变量，不要再写 `--dsw-alias-*`。
