export type FabricLocaleKey =
  | 'name'
  | 'launcher'
  | 'close'
  | 'navigation'
  | 'empty.pages'
  | 'empty.settings'
  | 'notice.dismiss'

export const zh: Record<FabricLocaleKey, string> = {
  name: 'Fabric',
  launcher: '打开 Fabric',
  close: '关闭',
  navigation: 'Fabric 页面',
  'empty.pages': '暂无可用页面',
  'empty.settings': '暂无设置项',
  'notice.dismiss': '关闭通知',
}

export const en: Record<FabricLocaleKey, string> = {
  name: 'Fabric',
  launcher: 'Open Fabric',
  close: 'Close',
  navigation: 'Fabric pages',
  'empty.pages': 'No pages available',
  'empty.settings': 'No settings available',
  'notice.dismiss': 'Dismiss notification',
}
