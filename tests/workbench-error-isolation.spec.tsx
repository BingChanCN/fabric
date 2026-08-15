// @vitest-environment jsdom
import { Component, createElement, type ComponentType, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricDialogRegistry } from '../src/client/dialogs.tsx'
import { mountClientPlugin, type FabricPageHandle } from '../src/client/plugin.ts'
import { guardPageComponent } from '../src/client/service.ts'
import type {
  FabricContribution, FabricPageContribution, FabricService, FabricToolbarContribution,
} from '../src/client/contract.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconWarningOutline16: () => <span>!</span>,
}))

afterEach(cleanup)

const gate = { fail: true }

function FlakyPage(): JSX.Element {
  if (gate.fail) throw new Error('page boom')
  return <div data-testid="page-ok">recovered</div>
}

class HostSlotBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    return this.state.failed ? <div data-testid="slot-crash" /> : this.props.children
  }
}

function createPageFixture() {
  const contributions: FabricContribution[] = []
  const dialogs = new FabricDialogRegistry()
  const service = {
    dialogs,
    register: (contribution: FabricContribution) => {
      contributions.push(contribution.kind === 'page'
        ? { ...contribution, component: guardPageComponent(contribution) }
        : contribution)
      return vi.fn()
    },
    notify: vi.fn(() => vi.fn()),
    open: vi.fn(),
    close: vi.fn(),
    setPageBadge: vi.fn(),
  } as unknown as FabricService
  let pageHandle!: FabricPageHandle
  const plugin = mountClientPlugin('@dsh-do/isolation-fixture', '1.0.0', {
    descriptor: { name: 'Isolation fixture' },
    setup(ctx) {
      pageHandle = ctx.pages.define({
        id: ' home ',
        label: 'Home',
        view: FlakyPage,
        actions: [{ id: ' refresh ', label: 'Refresh', onClick: () => {} }],
      })
    },
  })
  plugin.apply({ fabric: service, effect: vi.fn() })
  return { contributions, dialogs, pageHandle, service }
}

function pageOwner() {
  return {
    fabricPageErrorLabel: 'Page failed',
    fabricPageRetryLabel: 'Retry page',
    closeFabric: vi.fn(),
    openFabric: vi.fn(),
    notify: vi.fn(),
  }
}

describe('registered page error isolation', () => {
  it('places the retry boundary inside the host slot boundary', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    gate.fail = true
    const { contributions } = createPageFixture()
    const page = contributions.find((item): item is FabricPageContribution => item.kind === 'page')!
    const PageEntry = page.component as ComponentType<Record<string, unknown>>

    render(
      <HostSlotBoundary>
        {createElement(PageEntry, pageOwner())}
      </HostSlotBoundary>,
    )

    expect(screen.queryByTestId('slot-crash')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Page failed')

    gate.fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry page' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('page-ok')).toBeTruthy()
    consoleError.mockRestore()
  })

  it('normalizes page and action ids once for handles, registration, and visibility', () => {
    const { contributions, pageHandle } = createPageFixture()
    const page = contributions.find((item): item is FabricPageContribution => item.kind === 'page')!
    const action = contributions.find((item): item is FabricToolbarContribution => item.kind === 'toolbar')!

    expect(pageHandle.id).toBe('home')
    expect(page.id).toBe('isolation-fixture:home')
    expect(action.id).toBe('isolation-fixture:page/home/action/refresh')
    expect(action.component({ activePage: page.id } as never)).not.toBeNull()
  })
})
