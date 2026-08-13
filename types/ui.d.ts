import type { ReactElement, ReactNode } from 'react'
import type { AsyncResource, AsyncResourceSnapshot, Observable } from './sdk.d.ts'

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
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}
export declare function ToolbarButton(props: ToolbarButtonProps): ReactElement
