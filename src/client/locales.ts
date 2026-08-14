export type FabricLocaleKey =
  | 'name'
  | 'launcher'
  | 'close'
  | 'navigation'
  | 'empty.pages'
  | 'empty.settings'
  | 'notice.dismiss'
  | 'mods.title'
  | 'mods.description'
  | 'mods.empty'
  | 'mods.version'
  | 'mods.pages'
  | 'mods.configs'
  | 'mods.themes'
  | 'mods.openPage'
  | 'mods.ungrouped'
  | 'config.saving'
  | 'config.reset'
  | 'command.palette'
  | 'command.paletteHint'
  | 'command.empty'
  | 'command.open'
  | 'command.mods'
  | 'command.close'

export const zh: Record<FabricLocaleKey, string> = {
  name: 'Fabric',
  launcher: '打开 Fabric',
  close: '关闭',
  navigation: 'Fabric 页面',
  'empty.pages': '暂无可用页面',
  'empty.settings': '暂无设置项',
  'notice.dismiss': '关闭通知',
  'mods.title': '插件',
  'mods.description': '当前已加载的 Fabric 扩展、页面与配置',
  'mods.empty': '还没有下游插件注册',
  'mods.version': '版本',
  'mods.pages': '页面',
  'mods.configs': '配置',
  'mods.themes': '主题',
  'mods.openPage': '打开',
  'mods.ungrouped': '未分组贡献',
  'config.saving': '保存中',
  'config.reset': '还原',
  'command.palette': '命令面板',
  'command.paletteHint': '搜索命令…',
  'command.empty': '没有匹配的命令',
  'command.open': '打开 Fabric 工作台',
  'command.mods': '打开插件总览',
  'command.close': '关闭 Fabric 工作台',
}

export const en: Record<FabricLocaleKey, string> = {
  name: 'Fabric',
  launcher: 'Open Fabric',
  close: 'Close',
  navigation: 'Fabric pages',
  'empty.pages': 'No pages available',
  'empty.settings': 'No settings available',
  'notice.dismiss': 'Dismiss notification',
  'mods.title': 'Mods',
  'mods.description': 'Loaded Fabric extensions, pages, and configs',
  'mods.empty': 'No downstream plugins registered yet',
  'mods.version': 'Version',
  'mods.pages': 'Pages',
  'mods.configs': 'Configs',
  'mods.themes': 'Themes',
  'mods.openPage': 'Open',
  'mods.ungrouped': 'Ungrouped contributions',
  'config.saving': 'Saving',
  'config.reset': 'Reset',
  'command.palette': 'Command palette',
  'command.paletteHint': 'Search commands…',
  'command.empty': 'No matching commands',
  'command.open': 'Open Fabric workbench',
  'command.mods': 'Open mod catalog',
  'command.close': 'Close Fabric workbench',
}
