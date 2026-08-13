import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricController } from '../src/client/controller.ts'
import type { FabricPageCatalog } from '../src/client/controller.ts'
import type { FabricPageEntry } from '../src/client/contract.ts'

class MutableCatalog implements FabricPageCatalog {
  pages: readonly FabricPageEntry[]
  private readonly listeners = new Set<() => void>()

  constructor(pages: readonly FabricPageEntry[]) {
    this.pages = pages
  }

  read(): readonly FabricPageEntry[] {
    return this.pages
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  replace(pages: readonly FabricPageEntry[]): void {
    this.pages = pages
    for (const listener of this.listeners) listener()
  }
}

const page = (id: string, order: number, label = id): FabricPageEntry => ({ id, order, label })

afterEach(() => { vi.useRealTimers() })

describe('FabricController', () => {
  it('normalizes page metadata and follows the live catalog', () => {
    const catalog = new MutableCatalog([
      page(' beta ', 20, ' Beta '),
      page('alpha', 10, ''),
      page('alpha', 0, 'duplicate'),
      page('', 1),
    ])
    const controller = new FabricController(catalog)
    controller.start()

    expect(controller.getSnapshot().pages).toEqual([
      { id: 'alpha', label: 'alpha', order: 10 },
      { id: 'beta', label: 'Beta', order: 20 },
    ])
    expect(controller.getSnapshot().activePage).toBe('alpha')

    controller.navigate('beta')
    catalog.replace([page('gamma', 5, 'Gamma'), page('alpha', 10, 'Alpha')])

    expect(controller.getSnapshot()).toMatchObject({
      open: true,
      activePage: 'gamma',
      pages: [
        { id: 'gamma', label: 'Gamma', order: 5 },
        { id: 'alpha', label: 'Alpha', order: 10 },
      ],
    })
    controller.dispose()
  })

  it('opens, toggles and rejects unknown pages', () => {
    const controller = new FabricController(new MutableCatalog([page('home', 0), page('logs', 10)]))
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.open('logs')
    expect(controller.getSnapshot()).toMatchObject({ open: true, activePage: 'logs' })
    controller.toggle('logs')
    expect(controller.getSnapshot().open).toBe(false)
    controller.toggle()
    expect(controller.getSnapshot().open).toBe(true)
    expect(() => { controller.navigate('missing') }).toThrow('is not registered')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('auto-dismisses notices and supports persistent notices', () => {
    vi.useFakeTimers()
    const controller = new FabricController(new MutableCatalog([]))

    controller.notify(' Saved ', { tone: 'success', timeoutMs: 100 })
    const dismiss = controller.notify('Persistent', { timeoutMs: 0 })
    expect(controller.getSnapshot().notices.map(notice => notice.message)).toEqual(['Saved', 'Persistent'])

    vi.advanceTimersByTime(100)
    expect(controller.getSnapshot().notices.map(notice => notice.message)).toEqual(['Persistent'])
    dismiss()
    expect(controller.getSnapshot().notices).toEqual([])
    expect(() => { controller.notify('bad', { timeoutMs: -1 }) }).toThrow('finite non-negative')
    expect(controller.getSnapshot().notices).toEqual([])
  })
})
