import { ObservableStore } from '../sdk/observable.ts'
import { isEditableTarget, matchShortcut } from './shortcut.ts'

export type FabricCommandTitle = string | (() => string)

export interface FabricCommandDefinition {
  id: string
  title: FabricCommandTitle
  handler: (signal: AbortSignal) => void | Promise<void>
  description?: string
  shortcut?: string
  pluginId?: string
  order?: number
}

export type FabricCommandStatus = 'idle' | 'pending' | 'error'

export interface FabricCommandRecord {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly shortcut?: string
  readonly pluginId?: string
  readonly order: number
  readonly status: FabricCommandStatus
  readonly error?: Error
}

export interface FabricCommandSnapshot {
  readonly commands: readonly FabricCommandRecord[]
  readonly paletteOpen: boolean
  readonly revision: number
}

export interface FabricCommandService {
  register(command: FabricCommandDefinition): () => void
  execute(id: string): boolean
  cancel(id: string): boolean
  list(): readonly FabricCommandRecord[]
  openPalette(): void
  closePalette(): void
  togglePalette(): void
  isPaletteOpen(): boolean
  getSnapshot(): FabricCommandSnapshot
  subscribe(listener: () => void): () => void
  start(): () => void
}

/** In-memory command palette and global shortcut dispatcher. */
export class FabricCommandRegistry extends ObservableStore<FabricCommandSnapshot> implements FabricCommandService {
  private snapshot: FabricCommandSnapshot = Object.freeze({
    commands: Object.freeze([]),
    paletteOpen: false,
    revision: 0,
  })
  private readonly records = new Map<string, FabricCommandDefinition>()
  private readonly active = new Map<string, AbortController>()
  private readonly errors = new Map<string, Error>()

  constructor(private readonly onError?: (error: Error) => void) {
    super()
  }

  getSnapshot(): FabricCommandSnapshot {
    return this.snapshot
  }

  list(): readonly FabricCommandRecord[] {
    return this.snapshot.commands
  }

  isPaletteOpen(): boolean {
    return this.snapshot.paletteOpen
  }

  openPalette(): void {
    this.setSnapshot({ paletteOpen: true })
  }

  closePalette(): void {
    this.setSnapshot({ paletteOpen: false })
  }

  togglePalette(): void {
    this.setSnapshot({ paletteOpen: !this.snapshot.paletteOpen })
  }

  register(command: FabricCommandDefinition): () => void {
    if (this.records.has(command.id)) throw new Error(`fabric command "${command.id}" is already registered`)
    this.records.set(command.id, command)
    this.publishCommands()
    return () => {
      this.cancel(command.id)
      if (this.records.delete(command.id)) {
        this.errors.delete(command.id)
        this.publishCommands()
      }
    }
  }

  execute(id: string): boolean {
    const command = this.records.get(id)
    if (command === undefined || this.active.has(id)) return false
    const controller = new AbortController()
    this.active.set(id, controller)
    this.errors.delete(id)
    this.publishCommands()
    try {
      const result = command.handler(controller.signal)
      if (result === undefined) {
        this.active.delete(id)
        this.publishCommands()
      } else {
        void result.then(
          () => {
            if (this.active.get(id) !== controller) return
            this.active.delete(id)
            this.publishCommands()
          },
          error => {
            if (this.active.get(id) !== controller) return
            this.active.delete(id)
            const failure = error instanceof Error ? error : new Error(String(error))
            this.errors.set(id, failure)
            this.onError?.(failure)
            this.publishCommands()
          },
        )
      }
    } catch (error) {
      this.active.delete(id)
      const failure = error instanceof Error ? error : new Error(String(error))
      this.errors.set(id, failure)
      this.onError?.(failure)
      this.publishCommands()
    }
    return true
  }

  cancel(id: string): boolean {
    const controller = this.active.get(id)
    if (controller === undefined) return false
    controller.abort()
    this.active.delete(id)
    this.publishCommands()
    return true
  }

  start(): () => void {
    if (typeof window === 'undefined') return () => {}
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      if (this.snapshot.paletteOpen) return
      if (isEditableTarget(event.target) && !(event.metaKey || event.ctrlKey)) return
      for (const command of this.records.values()) {
        if (command.shortcut === undefined) continue
        if (!matchShortcut(event, command.shortcut)) continue
        event.preventDefault()
        this.execute(command.id)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }

  dispose(): void {
    for (const controller of this.active.values()) controller.abort()
    this.active.clear()
    this.records.clear()
    this.errors.clear()
    this.clearSubscribers()
    this.snapshot = Object.freeze({
      commands: Object.freeze([]),
      paletteOpen: false,
      revision: this.snapshot.revision + 1,
    })
  }

  private publishCommands(): void {
    const commands = [...this.records.values()]
      .map((command): FabricCommandRecord => {
        const error = this.errors.get(command.id)
        return Object.freeze({
          id: command.id,
          title: typeof command.title === 'function' ? command.title() : command.title,
          order: command.order ?? 0,
          status: this.active.has(command.id) ? 'pending' : error === undefined ? 'idle' : 'error',
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.shortcut !== undefined ? { shortcut: command.shortcut } : {}),
          ...(command.pluginId !== undefined ? { pluginId: command.pluginId } : {}),
          ...(error === undefined ? {} : { error }),
        })
      })
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    this.setSnapshot({ commands: Object.freeze(commands) })
  }

  private setSnapshot(patch: Partial<Omit<FabricCommandSnapshot, 'revision'>>): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    })
    this.publish()
  }
}
