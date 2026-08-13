import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { AsyncResource, AsyncResourceSnapshot, Observable } from '../sdk/index.ts'
import css from './ui.module.css'

/** Bind any Fabric observable without coupling the source to React. */
export function useObservable<T>(source: Observable<T>): T {
  return useSyncExternalStore(source.subscribe.bind(source), source.getSnapshot.bind(source), source.getSnapshot.bind(source))
}

/** Subscribe to a resource and optionally load it on mount. */
export function useAsyncResource<T>(resource: AsyncResource<T>, options: { load?: boolean } = {}): AsyncResourceSnapshot<T> {
  const snapshot = useObservable(resource)
  useEffect(() => {
    if (options.load === false || resource.getSnapshot().status !== 'idle') return
    void resource.load()
  }, [options.load, resource])
  return snapshot
}

export function Page({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={[css.page, className].filter(Boolean).join(' ')}>{children}</div>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className={css.pageHeader}>
      <div className={css.pageHeading}>
        <h3 className={css.pageTitle}>{title}</h3>
        {description !== undefined && <p className={css.pageDescription}>{description}</p>}
      </div>
      {actions !== undefined && <div className={css.pageActions}>{actions}</div>}
    </header>
  )
}

export function Section({ title, description, actions, children }: {
  title?: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className={css.section}>
      {(title !== undefined || description !== undefined || actions !== undefined) && (
        <div className={css.sectionHeader}>
          <div className={css.sectionHeading}>
            {title !== undefined && <h4 className={css.sectionTitle}>{title}</h4>}
            {description !== undefined && <p className={css.sectionDescription}>{description}</p>}
          </div>
          {actions !== undefined && <div className={css.sectionActions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <div className={css.state} role="status"><span className={css.spinner} aria-hidden />{label}</div>
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className={css.state}>
      <strong className={css.stateTitle}>{title}</strong>
      {description !== undefined && <span className={css.stateDescription}>{description}</span>}
      {action !== undefined && <div className={css.stateAction}>{action}</div>}
    </div>
  )
}

export function ErrorState({ error, retry, retryLabel = 'Retry' }: { error: Error | string; retry?: () => void; retryLabel?: string }) {
  return (
    <div className={css.state} role="alert">
      <strong className={css.errorTitle}>{error instanceof Error ? error.message : error}</strong>
      {retry !== undefined && <button type="button" className={css.button} onClick={retry}>{retryLabel}</button>}
    </div>
  )
}

/** Standard initial loading/error/value switch for an AsyncResource snapshot. */
export function AsyncView<T>({ snapshot, loadingLabel, retryLabel, empty, isEmpty, children, onRetry }: {
  snapshot: AsyncResourceSnapshot<T>
  loadingLabel?: string
  retryLabel?: string
  empty?: ReactNode
  isEmpty?: (value: T) => boolean
  children: (value: T, snapshot: AsyncResourceSnapshot<T>) => ReactNode
  onRetry?: () => void
}) {
  if (!snapshot.hasValue && (snapshot.status === 'idle' || snapshot.status === 'loading')) {
    return <LoadingState {...(loadingLabel === undefined ? {} : { label: loadingLabel })} />
  }
  if (!snapshot.hasValue && snapshot.error !== undefined) {
    return (
      <ErrorState
        error={snapshot.error}
        {...(onRetry === undefined ? {} : { retry: onRetry })}
        {...(retryLabel === undefined ? {} : { retryLabel })}
      />
    )
  }
  const value = snapshot.value as T
  if (isEmpty?.(value) === true) return empty === undefined ? null : <>{empty}</>
  return <>{children(value, snapshot)}</>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error' }) {
  return <span className={css.badge} data-tone={tone}>{children}</span>
}

export function ToolbarButton({ label, icon, onClick, disabled }: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" className={css.iconButton} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  )
}
