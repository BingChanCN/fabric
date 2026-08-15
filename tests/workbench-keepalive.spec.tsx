// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconCheckOutline16: () => <span>✓</span>,
  IconCloseOutline16: () => <span>✕</span>,
  IconWarningOutline16: () => <span>⚠</span>,
}))

import { Workbench } from '../src/client/components/Workbench.tsx'
import type { FabricSnapshot } from '../src/client/contract.ts'
import { FabricDialogRegistry } from '../src/client/dialogs.tsx'

function StatefulComponent({ testId, label }: { testId: string; label: string }) {
  const [count, setCount] = useState(0)
  return (
    <div data-testid={testId}>
      <span>{label}: {count}</span>
      <button type="button" onClick={() => { setCount(c => c + 1) }}>Increment {label}</button>
    </div>
  )
}

describe('Workbench Keep-Alive & Drawer Lifecycle', () => {
  it('preserves state for keepAlive pages and unmounts keepAlive: false pages', () => {
    let currentSnapshot: FabricSnapshot = {
      open: true,
      activePage: 'page1',
      pages: [
        { id: 'page1', label: 'Page 1', order: 0, keepAlive: true },
        { id: 'page2', label: 'Page 2', order: 1, keepAlive: false },
      ],
      notices: [],
      revision: 0,
    }

    const useFabric = <T,>(fn: (s: FabricSnapshot) => T) => fn(currentSnapshot)
    const closeFabric = vi.fn()
    const openFabric = vi.fn()
    const notify = vi.fn()
    const dismissNotice = vi.fn()
    const t = (k: string) => k

    const renderSlot = (name: string, _owner: unknown, options?: { only?: string }) => {
      if (name === 'fabric.page') {
        if (options?.only === 'page1') return <StatefulComponent testId="page1-content" label="Page1" />
        if (options?.only === 'page2') return <StatefulComponent testId="page2-content" label="Page2" />
      }
      return null
    }

    const commandSnapshot = Object.freeze({ commands: Object.freeze([]), paletteOpen: false, revision: 0 })
    const commands = {
      getSnapshot: () => commandSnapshot,
      subscribe: () => () => {},
      list: () => commandSnapshot.commands,
      execute: () => false,
      openPalette: () => {},
      closePalette: () => {},
      togglePalette: () => {},
      isPaletteOpen: () => false,
      register: () => () => {},
    }

    const dialogs = new FabricDialogRegistry()
    const getProps = () => ({
      renderSlot: renderSlot as any,
      useFabric: useFabric as any,
      closeFabric,
      openFabric,
      notify,
      dismissNotice,
      commands: commands as any,
      dialogs,
      t,
      useSessions: () => [] as any,
      useWorkspaces: () => [] as any,
    })

    const { rerender } = render(<Workbench {...getProps()} />)

    // Initially on page1
    expect(screen.getByTestId('page1-content')).toBeTruthy()
    expect(screen.getByText('Page1: 0')).toBeTruthy()

    // Increment count on page1
    fireEvent.click(screen.getByRole('button', { name: 'Increment Page1' }))
    expect(screen.getByText('Page1: 1')).toBeTruthy()

    // Switch to page2 (keepAlive: false)
    currentSnapshot = {
      ...currentSnapshot,
      activePage: 'page2',
      revision: 1,
    }

    rerender(<Workbench {...getProps()} />)

    // Page 2 is active, Page 1 is hidden in DOM but kept alive
    expect(screen.getByTestId('page2-content')).toBeTruthy()
    const page1El = screen.getByTestId('page1-content').parentElement
    expect(page1El?.hasAttribute('hidden')).toBe(true)
    expect(screen.getByText('Page1: 1')).toBeTruthy() // Page 1's state is still preserved!

    // Increment count on page2
    fireEvent.click(screen.getByRole('button', { name: 'Increment Page2' }))
    expect(screen.getByText('Page2: 1')).toBeTruthy()

    // Switch back to page1
    currentSnapshot = {
      ...currentSnapshot,
      activePage: 'page1',
      revision: 2,
    }

    rerender(<Workbench {...getProps()} />)

    // Page 1 is active with its preserved count
    expect(screen.getByText('Page1: 1')).toBeTruthy()
    // Page 2 was keepAlive: false, so it must be unmounted from DOM
    expect(screen.queryByTestId('page2-content')).toBeNull()

    // Close the workbench
    currentSnapshot = {
      ...currentSnapshot,
      open: false,
      revision: 3,
    }

    rerender(<Workbench {...getProps()} />)

    // Re-open the workbench
    currentSnapshot = {
      ...currentSnapshot,
      open: true,
      revision: 4,
    }

    rerender(<Workbench {...getProps()} />)

    // Page 1 count is STILL 1 (retained across workbench drawer close/open)
    expect(screen.getByTestId('page1-content')).toBeTruthy()
    expect(screen.getByText('Page1: 1')).toBeTruthy()
  })
})
