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
  | 'mods.runtime'
  | 'mods.installPath'
  | 'mods.install'
  | 'mods.trust'
  | 'mods.source'
  | 'mods.publisher'
  | 'mods.unscoped'
  | 'mods.update'
  | 'mods.retry'
  | 'mods.enable'
  | 'mods.disable'
  | 'mods.rollback'
  | 'mods.remove'
  | 'mods.purge'
  | 'mods.active'
  | 'mods.inactive'
  | 'mods.loading'
  | 'mods.failed'
  | 'mods.previous'
  | 'config.saving'
  | 'config.reset'
  | 'command.palette'
  | 'command.paletteHint'
  | 'command.empty'
  | 'command.open'
  | 'command.mods'
  | 'command.close'
  | 'page.error'
  | 'page.retry'

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
  'mods.runtime': 'Runtime Packages',
  'mods.installPath': 'npm 包规格或本地 tgz/目录',
  'mods.install': '安装',
  'mods.trust': 'Runtime Package 会在本机执行可信的 Host 与浏览器代码。安装前请核对来源、包名与发布者。',
  'mods.source': '来源',
  'mods.publisher': '发布者标识',
  'mods.unscoped': '无 scope 包',
  'mods.update': '更新',
  'mods.retry': '重试本页',
  'mods.enable': '启用',
  'mods.disable': '停用',
  'mods.rollback': '回退',
  'mods.remove': '移除',
  'mods.purge': '彻底删除',
  'mods.active': '运行中',
  'mods.inactive': '已停用',
  'mods.loading': '加载中',
  'mods.failed': '失败',
  'mods.previous': '可回退',
  'config.saving': '保存中',
  'config.reset': '还原',
  'command.palette': '命令面板',
  'command.paletteHint': '搜索命令…',
  'command.empty': '没有匹配的命令',
  'command.open': '打开 Fabric 工作台',
  'command.mods': '打开插件总览',
  'command.close': '关闭 Fabric 工作台',
  'page.error': '这个页面渲染失败，已隔离。其它页面不受影响。',
  'page.retry': '重试',
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
  'mods.runtime': 'Runtime Packages',
  'mods.installPath': 'npm spec or local tgz/directory',
  'mods.install': 'Install',
  'mods.trust': 'Runtime Packages execute trusted Host and browser code on this machine. Verify the source, package, and publisher before installing.',
  'mods.source': 'Source',
  'mods.publisher': 'Publisher identity',
  'mods.unscoped': 'unscoped package',
  'mods.update': 'Update',
  'mods.retry': 'Retry this tab',
  'mods.enable': 'Enable',
  'mods.disable': 'Disable',
  'mods.rollback': 'Rollback',
  'mods.remove': 'Remove',
  'mods.purge': 'Purge',
  'mods.active': 'Active',
  'mods.inactive': 'Disabled',
  'mods.loading': 'Loading',
  'mods.failed': 'Failed',
  'mods.previous': 'Previous',
  'config.saving': 'Saving',
  'config.reset': 'Reset',
  'command.palette': 'Command palette',
  'command.paletteHint': 'Search commands…',
  'command.empty': 'No matching commands',
  'command.open': 'Open Fabric workbench',
  'command.mods': 'Open mod catalog',
  'command.close': 'Close Fabric workbench',
  'page.error': 'This page failed to render and was isolated. Other pages are unaffected.',
  'page.retry': 'Retry',
}
