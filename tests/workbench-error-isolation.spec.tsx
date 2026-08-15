// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconCheckOutline16: () => <span>✓</span>,
  IconCloseOutline16: () => <span>✕</span>,
  IconWarningOutline16: () => <span>⚠</span>,
}))

import { Workbench } from '../src/client/components/Workbench.tsx'
import type { FabricSnapshot } from '../src/client/contract.ts'

const gate = { fail: false }

function CrashingPage(): never {
  throw new Error('boom')
}

function HealthyPage({ label }: { label: string }) {
  return <div data-testid="healthy">{label}</div>
}

function FlakyPage(): JSX.Element {
  if (gate.fail) throw new Error('flaky boom')
  return <div data-testid="flaky-ok">recovered</div>
}

function commandStub() {
  const snapshot = Object.freeze({ commands: Object.freeze([]), paletteOpen: false, revision: 0 })
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    list: () => snapshot.commands,
    execute: () => false,
    openPalette: () => {},
    closePalette: () => {},
    togglePalette: () => {},
    isPaletteOpen: () => false,
    register: () => () => {},
  }
}

function workbenchProps(currentSnapshot: FabricSnapshot, renderSlot: (name: string, _owner: unknown, options?: { only?: string }) => unknown) {
  return {
    renderSlot: renderSlot as never,
    useFabric: (fn: (s: FabricSnapshot) => unknown) => fn(currentSnapshot) as never,
    closeFabric: vi.fn(),
    openFabric: vi.fn(),
    notify: vi.fn(),
    dismissNotice: vi.fn(),
    commands: commandStub() as never,
    t: (k: string) => k,
    useSessions: () => [] as never,
    useWorkspaces: () => [] as never,
  }
}

describe('Workbench page error isolation', () => {
  it('isolates a crashing page and keeps visited sibling pages alive', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const snapshots: FabricSnapshot[] = [
      {
        open: true,
        activePage: 'healthy',
        pages: [
          { id: 'healthy', label: 'Healthy', order: 0, keepAlive: true },
          { id: 'crash', label: 'Crash', order: 1, keepAlive: false },
        ],
        notices: [],
        revision: 0,
      },
      {
        open: true,
        activePage: 'crash',
        pages: [
          { id: 'healthy', label: 'Healthy', order: 0, keepAlive: true },
          { id: 'crash', label: 'Crash', order: 1, keepAlive: false },
        ],
        notices: [],
        revision: 1,
      },
    ]
    let index = 0
    const renderSlot = (name: string, _owner: unknown, options?: { only?: string }) => {
      if (name === 'fabric.page') {
        if (options?.only === 'crash') return <CrashingPage />
        if (options?.only === 'healthy') return <HealthyPage label="healthy page" />
      }
      return null
    }
    const useFabric = (fn: (s: FabricSnapshot) => unknown) => fn(snapshots[index]!)
    const { rerender } = render(
      <Workbench {...workbenchProps(snapshots[0]!, renderSlot)} useFabric={useFabric as never} />,
    )
    expect(screen.getByText('healthy page')).toBeTruthy()

    // Navigate to the crashing page.
    index = 1
    rerender(<Workbench {...workbenchProps(snapshots[1]!, renderSlot)} useFabric={useFabric as never} />)

    // Crashing page shows the isolated fallback, not a dead tree.
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('page.error')).toBeTruthy()
    expect(consoleError).toHaveBeenCalled()

    // The keepAlive sibling is still mounted (hidden) in the DOM.
    expect(screen.getByTestId('healthy')).toBeTruthy()
    expect(screen.getByText('healthy page')).toBeTruthy()
    consoleError.mockRestore()
  })

  it('re-attempts the render after retry once the page can render again', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    gate.fail = true
    const currentSnapshot: FabricSnapshot = {
      open: true,
      activePage: 'flaky',
      pages: [{ id: 'flaky', label: 'Flaky', order: 0, keepAlive: true }],
      notices: [],
      revision: 0,
    }
    const renderSlot = (name: string) => {
      if (name === 'fabric.page') return <FlakyPage />
      return null
    }
    render(<Workbench {...workbenchProps(currentSnapshot, renderSlot)} />)
    expect(screen.getByRole('alert')).toBeTruthy()

    // The page becomes renderable again; retry should recover it.
    gate.fail = false
    fireEvent.click(screen.getByRole('button', { name: 'page.retry' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('flaky-ok')).toBeTruthy()
    consoleError.mockRestore()
  })
})
