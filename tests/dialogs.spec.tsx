// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogHost, FabricDialogRegistry } from '../src/client/dialogs.tsx'

afterEach(() => {
  cleanup()
  document.getElementById('fabric-portal-root')?.remove()
})

function CrashingDialog(): never {
  throw new Error('dialog boom')
}

describe('FabricDialogRegistry', () => {
  it('replaces duplicate ids and lets a live handle update and close the dialog', () => {
    const dialogs = new FabricDialogRegistry()
    const first = dialogs.open({ id: 'demo', title: 'First', content: 'one' }, { pluginId: 'alpha' })
    const second = dialogs.open({ id: 'demo', title: 'Second', content: 'two' }, { pluginId: 'alpha' })

    expect(dialogs.getSnapshot()).toHaveLength(1)
    expect(dialogs.getSnapshot()[0]?.title).toBe('Second')
    second.update({ title: 'Updated' })
    expect(dialogs.getSnapshot()[0]?.title).toBe('Updated')
    first.close()
    expect(dialogs.getSnapshot()).toHaveLength(0)
  })

  it('closes page and plugin-owned dialogs without touching other owners', () => {
    const dialogs = new FabricDialogRegistry()
    dialogs.open({ id: 'a-page', content: 'a' }, { pluginId: 'a', pageId: 'a:home' })
    dialogs.open({ id: 'a-global', content: 'a' }, { pluginId: 'a' })
    dialogs.open({ id: 'b-global', content: 'b' }, { pluginId: 'b' })

    dialogs.closePage('a:home')
    expect(dialogs.getSnapshot().map(dialog => dialog.id)).toEqual(['a-global', 'b-global'])
    dialogs.closeOwner('a')
    expect(dialogs.getSnapshot().map(dialog => dialog.id)).toEqual(['b-global'])
  })

  it('isolates a crashing dialog from sibling dialogs and the host', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dialogs = new FabricDialogRegistry()
    dialogs.open({ id: 'healthy', title: 'Healthy', content: 'healthy content' }, { pluginId: 'alpha' })
    dialogs.open({ id: 'crash', title: 'Crash', content: CrashingDialog }, { pluginId: 'alpha' })
    render(<DialogHost registry={dialogs} />)

    expect(screen.getByText('healthy content')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('dialog boom')
    expect(dialogs.getSnapshot()).toHaveLength(2)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('isolates the host and window shortcuts only while a modal dialog is open', () => {
    const background = document.createElement('main')
    document.body.appendChild(background)
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)
    const dialogs = new FabricDialogRegistry()
    const modal = dialogs.open({ id: 'modal', content: 'modal content' }, { pluginId: 'alpha' })
    render(<DialogHost registry={dialogs} />)

    expect(background.hasAttribute('inert')).toBe(true)
    expect(background.getAttribute('aria-hidden')).toBe('true')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'k', ctrlKey: true })
    expect(onWindowKeyDown).not.toHaveBeenCalled()

    act(() => { modal.close() })
    expect(background.hasAttribute('inert')).toBe(false)
    expect(background.getAttribute('aria-hidden')).toBeNull()

    let closeNonModal!: () => void
    act(() => {
      closeNonModal = dialogs.open({ id: 'non-modal', modal: false, content: 'non-modal content' }, { pluginId: 'alpha' }).close
    })
    expect(background.hasAttribute('inert')).toBe(false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'k', ctrlKey: true })
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1)

    act(() => { closeNonModal() })
    window.removeEventListener('keydown', onWindowKeyDown)
    background.remove()
  })

  it('covered masks cannot close a lower dialog', () => {
    const dialogs = new FabricDialogRegistry()
    dialogs.open({ id: 'first', content: 'one' }, { pluginId: 'alpha' })
    dialogs.open({ id: 'second', content: 'two' }, { pluginId: 'alpha' })
    render(<DialogHost registry={dialogs} />)

    const hosts = document.querySelectorAll<HTMLElement>('[data-modal="true"]')
    expect(hosts).toHaveLength(2)
    fireEvent.click(hosts[0]!.firstElementChild as HTMLElement)
    expect(dialogs.getSnapshot().map(dialog => dialog.id)).toEqual(['first', 'second'])
    fireEvent.click(hosts[1]!.firstElementChild as HTMLElement)
    expect(dialogs.getSnapshot().map(dialog => dialog.id)).toEqual(['first'])
  })

  it('Escape closes only the top dialog', () => {
    const dialogs = new FabricDialogRegistry()
    dialogs.open({ id: 'first', title: 'First', content: 'one' }, { pluginId: 'alpha' })
    dialogs.open({ id: 'second', title: 'Second', content: 'two' }, { pluginId: 'alpha' })
    render(<DialogHost registry={dialogs} />)

    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    const lower = screen.getByText('First').closest('[role="dialog"]') as HTMLElement
    const lowerHost = lower.parentElement as HTMLElement
    expect(lowerHost.getAttribute('aria-hidden')).toBe('true')
    expect(lowerHost.hasAttribute('inert')).toBe(true)
    expect(lower.getAttribute('aria-modal')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Second' }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(dialogs.getSnapshot().map(dialog => dialog.id)).toEqual(['first'])
    expect(screen.queryByText('Second')).toBeNull()
    expect(lowerHost.getAttribute('aria-hidden')).toBeNull()
    expect(lowerHost.hasAttribute('inert')).toBe(false)
    expect(lower.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(lower)
  })
})
