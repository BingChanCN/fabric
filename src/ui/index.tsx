import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AsyncResource, AsyncResourceSnapshot, Observable } from '../sdk/index.ts'
import type {
  ConfigSnapshot, ConfigStore, FabricConfigField, FabricConfigSchema, JsonRecord,
} from '../sdk/config.ts'
import type { JsonValue } from '../sdk/http.ts'
import css from './ui.module.css'

/** Z-Index layer contract matching framework elevation standards. */
export const Z_INDEX = {
  BASE: 0,
  STICKY: 10,
  DROPDOWN: 100,
  POPOVER: 200,
  DRAWER: 500,
  OVERLAY: 600,
  MODAL: 1000,
  TOAST: 2000,
} as const

/** Stable semantic tokens; the DSH bridge is private to the Fabric runtime. */
export const tokens = {
  bg: {
    base: 'var(--fabric-surface-base, #ffffff)',
    subtle: 'var(--fabric-surface-muted, #f3f4f6)',
    elevated: 'var(--fabric-surface-raised, #ffffff)',
    overlay: 'var(--fabric-surface-raised, #ffffff)',
    mask: 'var(--fabric-overlay-scrim, rgba(0, 0, 0, 0.45))',
  },
  text: {
    primary: 'var(--fabric-content-primary, #111827)',
    secondary: 'var(--fabric-content-secondary, #4b5563)',
    tertiary: 'var(--fabric-content-tertiary, #6b7280)',
    inverse: 'var(--fabric-content-inverse, #ffffff)',
  },
  border: {
    l1: 'var(--fabric-border-subtle, rgba(0, 0, 0, 0.08))',
    l2: 'var(--fabric-border-default, rgba(0, 0, 0, 0.14))',
    l3: 'var(--fabric-border-strong, rgba(0, 0, 0, 0.24))',
  },
  brand: {
    primary: 'var(--fabric-accent-primary, #2563eb)',
    hover: 'var(--fabric-accent-hover, #1d4ed8)',
  },
  state: {
    error: 'var(--fabric-state-danger-foreground, #991b1b)',
    warning: 'var(--fabric-state-warning-foreground, #92400e)',
    success: 'var(--fabric-state-success-foreground, #166534)',
    info: 'var(--fabric-state-info-foreground, #1d4ed8)',
  },
  font: {
    family: 'var(--fabric-font-family, system-ui, -apple-system, sans-serif)',
    mono: 'var(--fabric-font-mono, ui-monospace, SFMono-Regular, monospace)',
  },
} as const

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

/** Renders children into a dedicated overlay portal container on document.body. */
export function Portal({ children, container }: { children: ReactNode; container?: HTMLElement | null }) {
  const [target, setTarget] = useState<HTMLElement | null>(() => {
    if (container !== undefined) return container
    if (typeof document === 'undefined') return null
    return document.getElementById('fabric-portal-root')
  })

  useEffect(() => {
    if (container !== undefined) {
      setTarget(container)
      return
    }
    if (typeof document === 'undefined') return
    let el = document.getElementById('fabric-portal-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'fabric-portal-root'
      document.body.appendChild(el)
    }
    setTarget(el)
  }, [container])

  if (!target) return null
  return createPortal(children, target)
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
  closeOnEsc?: boolean
  closeOnOverlayClick?: boolean
  className?: string
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnEsc = true,
  closeOnOverlayClick = true,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open || !closeOnEsc) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, closeOnEsc, onClose])

  useEffect(() => {
    if (open) {
      dialogRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <Portal>
      <div className={css.modalHost}>
        <div
          className={css.modalMask}
          aria-hidden="true"
          onClick={closeOnOverlayClick ? onClose : undefined}
        />
        <div
          ref={dialogRef}
          className={[css.modalDialog, className].filter(Boolean).join(' ')}
          data-size={size}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
        >
          {(title !== undefined || description !== undefined) && (
            <header className={css.modalHeader}>
              <div className={css.modalHeading}>
                {title !== undefined && <h3 id={titleId} className={css.modalTitle}>{title}</h3>}
                {description !== undefined && <p className={css.modalDescription}>{description}</p>}
              </div>
              <button
                type="button"
                className={css.iconButton}
                aria-label="Close dialog"
                onClick={onClose}
              >
                ✕
              </button>
            </header>
          )}
          <div className={css.modalBody}>{children}</div>
          {footer !== undefined && <footer className={css.modalFooter}>{footer}</footer>}
        </div>
      </div>
    </Portal>
  )
}

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

export function Popover({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  trigger,
  content,
  placement = 'bottom',
  closeOnClickOutside = true,
  closeOnEsc = true,
  className,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const updatePosition = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6
    let top = 0
    let left = 0

    if (placement === 'bottom') {
      top = rect.bottom + gap
      left = rect.left
    } else if (placement === 'top') {
      top = rect.top - gap
      left = rect.left
    } else if (placement === 'left') {
      top = rect.top
      left = rect.left - gap
    } else if (placement === 'right') {
      top = rect.top
      left = rect.right + gap
    }

    setCoords({ top, left })
  }

  useEffect(() => {
    if (isOpen) {
      updatePosition()
      const onScrollOrResize = () => { updatePosition() }
      window.addEventListener('resize', onScrollOrResize)
      window.addEventListener('scroll', onScrollOrResize, true)
      return () => {
        window.removeEventListener('resize', onScrollOrResize)
        window.removeEventListener('scroll', onScrollOrResize, true)
      }
    }
  }, [isOpen, placement])

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!closeOnClickOutside) return
      const target = e.target as Node | null
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, closeOnClickOutside, closeOnEsc])

  return (
    <>
      <div
        ref={triggerRef}
        className={css.popoverTriggerWrapper}
        onClick={() => { setOpen(!isOpen) }}
      >
        {trigger}
      </div>
      {isOpen && (
        <Portal>
          <div
            ref={panelRef}
            className={[css.popoverPanel, className].filter(Boolean).join(' ')}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  )
}

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

export function useFabricConfig<T extends JsonRecord = JsonRecord>(handle: {
  readonly id: string
  getSnapshot(): ConfigSnapshot<T>
  subscribe(listener: () => void): () => void
  set(patch: Partial<T>): void
  reset(): void
  load(): Promise<ConfigSnapshot<T>>
  persist(): Promise<ConfigSnapshot<T>>
}): {
  values: T
  status: ConfigSnapshot<T>['status']
  dirty: boolean
  error: Error | undefined
  seq: number
  set: (patch: Partial<T>) => void
  reset: () => void
  reload: () => Promise<ConfigSnapshot<T>>
  persist: () => Promise<ConfigSnapshot<T>>
} {
  const snapshot = useObservable(handle)
  return {
    values: snapshot.values,
    status: snapshot.status,
    dirty: snapshot.dirty,
    error: snapshot.error,
    seq: snapshot.seq,
    set: patch => { handle.set(patch) },
    reset: () => { handle.reset() },
    reload: () => handle.load(),
    persist: () => handle.persist(),
  }
}

export function ConfigForm({ schema, values, onChange, disabled }: {
  schema: FabricConfigSchema
  values: JsonRecord
  onChange: (patch: JsonRecord) => void
  disabled?: boolean
}) {
  return (
    <div className={css.configForm}>
      {Object.entries(schema).map(([key, field]) => (
        <ConfigFieldControl
          key={key}
          id={key}
          field={field}
          value={values[key]}
          disabled={disabled === true}
          onChange={next => { onChange({ [key]: next }) }}
        />
      ))}
    </div>
  )
}

export function BoundConfigForm({ store, disabled }: { store: ConfigStore; disabled?: boolean }) {
  const snapshot = useObservable(store)
  return (
    <ConfigForm
      schema={store.schema}
      values={snapshot.values}
      onChange={patch => { store.set(patch) }}
      disabled={disabled === true || snapshot.status === 'loading'}
    />
  )
}

function ConfigFieldControl({
  id, field, value, disabled, onChange,
}: {
  id: string
  field: FabricConfigField
  value: JsonValue | undefined
  disabled: boolean
  onChange: (value: JsonValue) => void
}) {
  const controlId = `fabric-config-${id}`
  return (
    <label className={css.configField} htmlFor={controlId}>
      <span className={css.configFieldTitle}>{field.title}</span>
      {field.description !== undefined && <span className={css.configFieldDescription}>{field.description}</span>}
      {field.type === 'boolean' && (
        <input
          id={controlId}
          type="checkbox"
          className={css.configCheckbox}
          checked={value === true}
          disabled={disabled}
          onChange={event => { onChange(event.target.checked) }}
        />
      )}
      {field.type === 'string' && (
        <input
          id={controlId}
          type="text"
          className={css.configInput}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          placeholder={'placeholder' in field ? field.placeholder : undefined}
          onChange={event => { onChange(event.target.value) }}
        />
      )}
      {field.type === 'textarea' && (
        <textarea
          id={controlId}
          className={css.configTextarea}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          placeholder={'placeholder' in field ? field.placeholder : undefined}
          onChange={event => { onChange(event.target.value) }}
        />
      )}
      {field.type === 'number' && (
        <input
          id={controlId}
          type="number"
          className={css.configInput}
          value={typeof value === 'number' ? value : 0}
          disabled={disabled}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={event => {
            const next = event.target.valueAsNumber
            if (!Number.isNaN(next)) onChange(next)
          }}
        />
      )}
      {field.type === 'select' && (
        <select
          id={controlId}
          className={css.configSelect}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={event => { onChange(event.target.value) }}
        >
          {field.options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
    </label>
  )
}

export function Dropdown({ trigger, items, placement = 'bottom', className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      placement={placement}
      {...(className !== undefined ? { className } : {})}
      content={
        <div className={css.dropdownMenu} role="menu">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={css.dropdownItem}
              disabled={item.disabled}
              data-danger={item.danger || undefined}
              onClick={() => {
                if (item.disabled) return
                setOpen(false)
                item.onClick?.()
              }}
            >
              {item.icon && <span className={css.dropdownItemIcon}>{item.icon}</span>}
              <span className={css.dropdownItemLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      }
    />
  )
}
