import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { FabricService } from '../contract.ts'
import type { FabricLocaleKey } from '../locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    fabric: FabricLocaleKey
  }
}

export interface WorkbenchInjected {
  hooks: { fabric: FabricService }
  closeFabric: () => void
  openFabric: (pageId?: string) => void
  notify: FabricService['notify']
  dismissNotice: (id: string) => void
}

export type WorkbenchProps =
  & PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'fabric.page' | 'fabric.toolbar.action' | 'fabric.overlay'>
  & PropsLocale<'fabric'>
  & InjectFace<WorkbenchInjected>

export interface LauncherInjected {
  openFabric: () => void
}

export type LauncherProps =
  & PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'fabric'>
  & LauncherInjected

export interface FabricSettingsInjected {
  openFabric: (pageId?: string) => void
  notify: FabricService['notify']
}

export type FabricSettingsProps =
  & PropsRuntime<'settings.plugins.tab'>
  & PropsRenderSlots<'fabric.settings'>
  & PropsLocale<'fabric'>
  & FabricSettingsInjected
