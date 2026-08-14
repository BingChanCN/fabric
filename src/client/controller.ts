import type {
  FabricNotice, FabricNoticeOptions, FabricPageEntry, FabricSnapshot,
} from './contract.ts'

/** Page-ledger adapter keeps the controller independent of DSH runtime machinery. */
export interface FabricPageCatalog {
  read(): readonly FabricPageEntry[]
  subscribe(listener: () => void): () => void
}

const DEFAULT_NOTICE_TIMEOUT_MS = 4500

function samePages(left: readonly FabricPageEntry[], right: readonly FabricPageEntry[]): boolean {
  return left.length === right.length && left.every((page, index) => {
    const other = right[index]
    return other !== undefined
      && page.id === other.id
      && page.label === other.label
      && page.order === other.order
      && page.icon === other.icon
      && page.badge === other.badge
      && page.keepAlive === other.keepAlive
  })
}

function freezePages(pages: readonly FabricPageEntry[]): readonly FabricPageEntry[] {
  const seen = new Set<string>()
  const normalized: FabricPageEntry[] = []
  for (const page of pages) {
    const id = page.id.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    normalized.push(Object.freeze({
      id,
      label: page.label.trim() || id,
      order: Number.isFinite(page.order) ? page.order : 0,
      ...(page.icon !== undefined ? { icon: page.icon } : {}),
      ...(page.badge !== undefined ? { badge: page.badge } : {}),
      keepAlive: page.keepAlive !== false,
    }))
  }
  normalized.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  return Object.freeze(normalized)
}

/** Observable state machine backing the public Fabric browser service. */
export class FabricController {
  private snapshot: FabricSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private stopCatalog: (() => void) | undefined
  private noticeSequence = 0

  constructor(private readonly catalog: FabricPageCatalog) {
    const pages = freezePages(catalog.read())
    this.snapshot = Object.freeze({
      open: false,
      activePage: pages[0]?.id,
      pages,
      notices: Object.freeze([]),
      revision: 0,
    })
  }

  /** Begin following the slot ledger. Idempotent for convenient effect wiring. */
  start(): () => void {
    if (this.stopCatalog !== undefined) return this.stopCatalog
    const stop = this.catalog.subscribe(() => { this.refreshPages() })
    let active = true
    this.stopCatalog = () => {
      if (!active) return
      active = false
      stop()
      this.stopCatalog = undefined
    }
    this.refreshPages()
    return this.stopCatalog
  }

  getSnapshot(): FabricSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(pageId?: string): void {
    const activePage = pageId === undefined ? this.snapshot.activePage ?? this.snapshot.pages[0]?.id : this.requirePage(pageId)
    this.update({ open: true, activePage })
  }

  close(): void {
    this.update({ open: false })
  }

  toggle(pageId?: string): void {
    if (this.snapshot.open && (pageId === undefined || pageId === this.snapshot.activePage)) {
      this.close()
      return
    }
    this.open(pageId)
  }

  navigate(pageId: string): void {
    this.update({ open: true, activePage: this.requirePage(pageId) })
  }

  notify(message: string, options: FabricNoticeOptions = {}): () => void {
    const text = message.trim()
    if (text === '') throw new Error('fabric notice message must not be empty')
    const id = `fabric-notice-${++this.noticeSequence}`
    const notice: FabricNotice = Object.freeze({
      id,
      message: text,
      tone: options.tone ?? 'info',
    })
    this.update({ notices: Object.freeze([...this.snapshot.notices, notice]) })
    const timeoutMs = options.timeoutMs ?? DEFAULT_NOTICE_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      this.dismissNotice(id)
      throw new Error('fabric notice timeoutMs must be a finite non-negative number')
    }
    if (timeoutMs > 0) {
      this.noticeTimers.set(id, setTimeout(() => { this.dismissNotice(id) }, timeoutMs))
    }
    return () => { this.dismissNotice(id) }
  }

  dismissNotice(id: string): void {
    const timer = this.noticeTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.noticeTimers.delete(id)
    }
    const notices = this.snapshot.notices.filter(notice => notice.id !== id)
    if (notices.length === this.snapshot.notices.length) return
    this.update({ notices: Object.freeze(notices) })
  }

  /** Release timers and subscriptions when the owning Cordis fiber unloads. */
  dispose(): void {
    this.stopCatalog?.()
    for (const timer of this.noticeTimers.values()) clearTimeout(timer)
    this.noticeTimers.clear()
    this.listeners.clear()
  }

  private refreshPages(): void {
    const pages = freezePages(this.catalog.read())
    if (samePages(pages, this.snapshot.pages)) return
    const activePage = this.snapshot.activePage !== undefined && pages.some(page => page.id === this.snapshot.activePage)
      ? this.snapshot.activePage
      : pages[0]?.id
    this.update({ pages, activePage })
  }

  private requirePage(pageId: string): string {
    if (!this.snapshot.pages.some(page => page.id === pageId)) {
      throw new Error(`fabric page "${pageId}" is not registered`)
    }
    return pageId
  }

  private update(patch: Partial<Pick<FabricSnapshot, 'open' | 'activePage' | 'pages' | 'notices'>>): void {
    const next = Object.freeze({
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    })
    if (
      next.open === this.snapshot.open
      && next.activePage === this.snapshot.activePage
      && next.pages === this.snapshot.pages
      && next.notices === this.snapshot.notices
    ) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
