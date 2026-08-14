// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Dropdown, Modal, Popover, Portal, tokens, Z_INDEX,
} from '../src/ui/index.tsx'

describe('Fabric Overlay Primitives', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('exposes design tokens and elevation z-indexes', () => {
    expect(Z_INDEX.MODAL).toBe(1000)
    expect(Z_INDEX.POPOVER).toBe(200)
    expect(Z_INDEX.DROPDOWN).toBe(100)
    expect(tokens.bg.base).toContain('var(--dsw-alias-bg-base')
    expect(tokens.brand.primary).toContain('var(--dsw-alias-brand-primary')
  })

  it('renders children into document.body via Portal', () => {
    render(
      <Portal>
        <div data-testid="portal-content">Hello Portal</div>
      </Portal>,
    )
    const portalEl = screen.getByTestId('portal-content')
    expect(portalEl).toBeTruthy()
    expect(document.getElementById('fabric-portal-root')?.contains(portalEl)).toBe(true)
  })

  it('controls Modal lifecycle, backdrop click and Escape key dismissal', () => {
    const handleClose = vi.fn()
    const { rerender } = render(
      <Modal open={true} onClose={handleClose} title="Edit Theme" description="Modify tokens">
        <div>Modal Content</div>
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'Edit Theme' })).toBeTruthy()
    expect(screen.getByText('Modify tokens')).toBeTruthy()
    expect(screen.getByText('Modal Content')).toBeTruthy()

    // Test ESC key
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)

    // Test mask click
    const mask = document.querySelector('[class*="modalMask"]')
    expect(mask).toBeTruthy()
    if (mask) fireEvent.click(mask)
    expect(handleClose).toHaveBeenCalledTimes(2)

    // Rerender as closed
    rerender(
      <Modal open={false} onClose={handleClose} title="Edit Theme">
        <div>Modal Content</div>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('controls Popover trigger toggle and outside click closing', () => {
    const handleOpenChange = vi.fn()
    render(
      <Popover
        trigger={<button type="button">Open Popover</button>}
        content={<div data-testid="popover-content">Popover Body</div>}
        onOpenChange={handleOpenChange}
      />,
    )

    expect(screen.queryByTestId('popover-content')).toBeNull()

    // Click trigger to open
    fireEvent.click(screen.getByRole('button', { name: 'Open Popover' }))
    expect(screen.getByTestId('popover-content')).toBeTruthy()
    expect(handleOpenChange).toHaveBeenCalledWith(true)

    // Click outside to close
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('popover-content')).toBeNull()
  })

  it('renders Dropdown items and dispatches action click', () => {
    const handleAction = vi.fn()
    render(
      <Dropdown
        trigger={<button type="button">Menu</button>}
        items={[
          { id: 'save', label: 'Save', onClick: handleAction },
          { id: 'del', label: 'Delete', danger: true, disabled: true },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menu')).toBeTruthy()

    const saveItem = screen.getByRole('menuitem', { name: 'Save' })
    fireEvent.click(saveItem)
    expect(handleAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
