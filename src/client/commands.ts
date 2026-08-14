import { ObservableStore } from '../sdk/observable.ts'
import { isEditableTarget, matchShortcut } from './shortcut.ts'

export type FabricCommandTitle = string | (() => string)

export interface FabricCommandDefinition {
  id: string
  title: FabricCommandTitle
  handler: () => void
  description?: string
  shortcut?: string
  pluginId?: string
  order?: number
}

export interface FabricCommandRecord {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly shortcut?: string
  readonly pluginId?: string
  readonly order: number
}

export interface FabricCommandSnapshot {
  readonly commands: readonly FabricCommandRecord[]
  readonly paletteOpen: boolean
  readonly revision: number
}

export interface FabricCommandService {
  register(command: FabricCommandDefinition): () => void
  execute(id: string): boolean
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
    if (this.records.has(command.id)) {
      throw new Error(`fabric command "${command.id}" is already registered`)
    }
    this.records.set(command.id, command)
    this.publishCommands()
    return () => {
      this.records.delete(command.id)
      this.publishCommands()
    }
  }

  execute(id: string): boolean {
    const command = this.records.get(id)
    if (command === undefined) return false
    try {
      command.handler()
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)))
      return false
    }
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
    this.records.clear()
    this.clearSubscribers()
    this.snapshot = Object.freeze({
      commands: Object.freeze([]),
      paletteOpen: false,
      revision: this.snapshot.revision + 1,
    })
  }

  private publishCommands(): void {
    const commands = [...this.records.values()]
      .map((command): FabricCommandRecord => Object.freeze({
        id: command.id,
        title: typeof command.title === 'function' ? command.title() : command.title,
        order: command.order ?? 0,
        ...(command.description !== undefined ? { description: command.description } : {}),
        ...(command.shortcut !== undefined ? { shortcut: command.shortcut } : {}),
        ...(command.pluginId !== undefined ? { pluginId: command.pluginId } : {}),
      }))
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
