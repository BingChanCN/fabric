import {
  Component, createElement, useEffect, useSyncExternalStore,
  type ComponentType, type ErrorInfo, type ReactNode,
} from 'react'
import { ErrorState, Modal } from '../ui/index.tsx'

export type FabricDialogSize = 'sm' | 'md' | 'lg' | 'full'

export interface FabricDialogContentProps {
  readonly dialog: FabricDialogHandle
}

export type FabricDialogContent = ReactNode | ComponentType<FabricDialogContentProps>

export interface FabricDialogDefinition {
  readonly id: string
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly content: FabricDialogContent
  readonly footer?: ReactNode
  readonly size?: FabricDialogSize
  /** Modal by default. Non-modal dialogs omit the mask and leave the shell interactive. */
  readonly modal?: boolean
  readonly closeOnOverlayClick?: boolean
}

export type FabricDialogUpdate = Partial<Omit<FabricDialogDefinition, 'id'>>

export interface FabricDialogHandle {
  readonly id: string
  close(): void
  update(patch: FabricDialogUpdate): void
}

export interface FabricDialogScope {
  open(definition: FabricDialogDefinition): FabricDialogHandle
}

interface DialogOwner {
  readonly pluginId: string
  readonly pageId?: string
}

interface DialogEntry extends FabricDialogDefinition {
  readonly owner: DialogOwner
  readonly revision: number
}

/** Profile-singleton dialog stack. Public plugin APIs add ownership before entering this registry. */
export class FabricDialogRegistry {
  private entries: readonly DialogEntry[] = Object.freeze([])
  private readonly listeners = new Set<() => void>()
  private revision = 0

  getSnapshot = (): readonly DialogEntry[] => this.entries

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(definition: FabricDialogDefinition, owner: DialogOwner): FabricDialogHandle {
    const id = definition.id.trim()
    if (id === '') throw new Error('fabric dialog id must not be empty')
    if (definition.content === undefined) throw new Error(`fabric dialog "${id}" requires content`)

    const entry: DialogEntry = Object.freeze({
      ...definition,
      id,
      modal: definition.modal !== false,
      closeOnOverlayClick: definition.closeOnOverlayClick !== false,
      owner: Object.freeze({ ...owner }),
      revision: ++this.revision,
    })
    this.publish(Object.freeze([...this.entries.filter(item => item.id !== id), entry]))
    return this.handle(id)
  }

  close(id: string): void {
    const next = this.entries.filter(entry => entry.id !== id)
    if (next.length === this.entries.length) return
    this.publish(Object.freeze(next))
  }

  closeTop(): void {
    const top = this.entries.at(-1)
    if (top !== undefined) this.close(top.id)
  }

  closeOwner(pluginId: string): void {
    this.closeWhere(entry => entry.owner.pluginId === pluginId)
  }

  closePage(pageId: string): void {
    this.closeWhere(entry => entry.owner.pageId === pageId)
  }

  dispose(): void {
    this.entries = Object.freeze([])
    this.listeners.clear()
  }

  handle(id: string): FabricDialogHandle {
    return Object.freeze({
      id,
      close: () => { this.close(id) },
      update: (patch: FabricDialogUpdate) => { this.update(id, patch) },
    })
  }

  private update(id: string, patch: FabricDialogUpdate): void {
    const index = this.entries.findIndex(entry => entry.id === id)
    if (index < 0) throw new Error(`fabric dialog "${id}" is not open`)
    const current = this.entries[index]!
    const nextEntry: DialogEntry = Object.freeze({ ...current, ...patch, id, owner: current.owner, revision: ++this.revision })
    const next = [...this.entries]
    next[index] = nextEntry
    this.publish(Object.freeze(next))
  }

  private closeWhere(predicate: (entry: DialogEntry) => boolean): void {
    const next = this.entries.filter(entry => !predicate(entry))
    if (next.length === this.entries.length) return
    this.publish(Object.freeze(next))
  }

  private publish(entries: readonly DialogEntry[]): void {
    this.entries = entries
    for (const listener of [...this.listeners]) listener()
  }
}

class DialogErrorBoundary extends Component<{
  readonly children: ReactNode
  readonly resetKey: number
}, { readonly error: Error | undefined }> {
  state: { readonly error: Error | undefined } = { error: undefined }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Fabric dialog content crashed', error, info.componentStack)
  }

  componentDidUpdate(previous: Readonly<{ readonly resetKey: number }>): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== undefined) {
      this.setState({ error: undefined })
    }
  }

  render() {
    if (this.state.error !== undefined) {
      return <ErrorState error={this.state.error} retry={() => { this.setState({ error: undefined }) }} />
    }
    return this.props.children
  }
}

function DialogContent({ entry, registry, active }: {
  entry: DialogEntry
  registry: FabricDialogRegistry
  active: boolean
}) {
  const handle = registry.handle(entry.id)
  const content = typeof entry.content === 'function'
    ? createElement(entry.content, { dialog: handle })
    : entry.content

  return (
    <Modal
      open
      modal={entry.modal !== false}
      active={active}
      autoFocus={active}
      onClose={handle.close}
      title={entry.title}
      description={entry.description}
      footer={entry.footer}
      {...(entry.size === undefined ? {} : { size: entry.size })}
      closeOnEsc={false}
      closeOnOverlayClick={active && entry.closeOnOverlayClick !== false}
    >
      <DialogErrorBoundary resetKey={entry.revision}>{content}</DialogErrorBoundary>
    </Modal>
  )
}

/** Renders the stack and owns the single Escape listener for top-only close semantics. */
export function DialogHost({ registry }: { registry: FabricDialogRegistry }) {
  const entries = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  const hasModal = entries.some(entry => entry.modal !== false)

  useEffect(() => {
    if (!hasModal) return
    const portalRoot = document.getElementById('fabric-portal-root')
    const background = [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portalRoot)
      .map(element => ({
        element,
        inert: element.hasAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      }))
    for (const { element } of background) {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    }
    return () => {
      for (const { element, inert, ariaHidden } of background) {
        if (!inert) element.removeAttribute('inert')
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
    }
  }, [hasModal])

  useEffect(() => {
    if (entries.length === 0) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      registry.closeTop()
    }
    const blockWindowShortcuts = (event: KeyboardEvent): void => {
      if (hasModal && event.key !== 'Escape') event.stopPropagation()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keydown', blockWindowShortcuts)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keydown', blockWindowShortcuts)
    }
  }, [entries.length, hasModal, registry])

  return entries.map((entry, index) => (
    <DialogContent
      key={entry.id}
      entry={entry}
      registry={registry}
      active={index === entries.length - 1}
    />
  ))
}
