import type { ReactElement, ReactNode } from 'react'
import type {
  AsyncResource, AsyncResourceSnapshot, ConfigSnapshot, ConfigStore, FabricConfigSchema,
  JsonRecord, Observable,
} from './sdk.d.ts'
import type { FabricConfigHandle } from './client.d.ts'

export declare const Z_INDEX: {
  readonly BASE: 0
  readonly STICKY: 10
  readonly DROPDOWN: 100
  readonly POPOVER: 200
  readonly DRAWER: 500
  readonly OVERLAY: 600
  readonly MODAL: 1000
  readonly TOAST: 2000
}

export declare const tokens: {
  readonly bg: {
    readonly base: string
    readonly subtle: string
    readonly elevated: string
    readonly overlay: string
    readonly mask: string
  }
  readonly text: {
    readonly primary: string
    readonly secondary: string
    readonly tertiary: string
    readonly inverse: string
  }
  readonly border: {
    readonly l1: string
    readonly l2: string
    readonly l3: string
  }
  readonly brand: {
    readonly primary: string
    readonly hover: string
  }
  readonly state: {
    readonly error: string
    readonly warning: string
    readonly success: string
    readonly info: string
  }
  readonly font: {
    readonly family: string
    readonly mono: string
  }
}

export declare function useObservable<T>(source: Observable<T>): T
export declare function useAsyncResource<T>(resource: AsyncResource<T>, options?: { load?: boolean }): AsyncResourceSnapshot<T>

export interface PageProps {
  children?: ReactNode
  className?: string
}
export declare function Page(props: PageProps): ReactElement

export interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}
export declare function PageHeader(props: PageHeaderProps): ReactElement

export interface SectionProps {
  title?: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}
export declare function Section(props: SectionProps): ReactElement

export declare function LoadingState(props?: { label?: string }): ReactElement
export declare function EmptyState(props: { title: string; description?: string; action?: ReactNode }): ReactElement
export declare function ErrorState(props: { error: Error | string; retry?: () => void; retryLabel?: string }): ReactElement

export interface AsyncViewProps<T> {
  snapshot: AsyncResourceSnapshot<T>
  loadingLabel?: string
  retryLabel?: string
  empty?: ReactNode
  isEmpty?: (value: T) => boolean
  children: (value: T, snapshot: AsyncResourceSnapshot<T>) => ReactNode
  onRetry?: () => void
}
export declare function AsyncView<T>(props: AsyncViewProps<T>): ReactElement | null

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'
export declare function Badge(props: { children: ReactNode; tone?: BadgeTone }): ReactElement

export interface ToolbarButtonProps {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  tone?: 'default' | 'destructive'
  tooltip?: string
}
export declare function ToolbarButton(props: ToolbarButtonProps): ReactElement

export interface PortalProps {
  children: ReactNode
  container?: HTMLElement | null
}
export declare function Portal(props: PortalProps): ReactElement | null

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
  modal?: boolean
  autoFocus?: boolean
  active?: boolean
  closeOnEsc?: boolean
  closeOnOverlayClick?: boolean
  className?: string
}
export declare function Modal(props: ModalProps): ReactElement | null

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface PopoverProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  trigger: ReactNode
  content: ReactNode
  placement?: PopoverPlacement
  closeOnClickOutside?: boolean
  closeOnEsc?: boolean
  className?: string
}
export declare function Popover(props: PopoverProps): ReactElement

export interface DropdownItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
}

export interface DropdownProps {
  trigger: ReactNode
  items: readonly DropdownItem[]
  placement?: PopoverPlacement
  className?: string
}
export declare function Dropdown(props: DropdownProps): ReactElement

export declare function useFabricConfig<T extends JsonRecord = JsonRecord>(handle: FabricConfigHandle<T>): {
  values: T
  status: ConfigSnapshot<T>['status']
  dirty: boolean
  error: Error | undefined
  seq: number
  set: (patch: Partial<T>) => void
  reset: () => void
  reload: () => Promise<ConfigSnapshot<T>>
  persist: () => Promise<ConfigSnapshot<T>>
}

export interface ConfigFormProps {
  schema: FabricConfigSchema
  values: JsonRecord
  onChange: (patch: JsonRecord) => void
  disabled?: boolean
}
export declare function ConfigForm(props: ConfigFormProps): ReactElement
export declare function BoundConfigForm(props: { store: ConfigStore; disabled?: boolean }): ReactElement
