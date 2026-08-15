// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeclarativePageAction } from '../src/client/components/PageAction.tsx'
import { FabricDialogRegistry } from '../src/client/dialogs.tsx'
import type { FabricPageActionProps } from '../src/client/plugin.ts'

afterEach(cleanup)

function actionContext(notify = vi.fn()): FabricPageActionProps {
  const dialogs = new FabricDialogRegistry()
  return {
    pageId: 'home',
    activePage: 'home',
    signal: new AbortController().signal,
    dialogs: { open: definition => dialogs.open(definition, { pluginId: 'test', pageId: 'test:home' }) },
    open: vi.fn(),
    close: vi.fn(),
    notify,
  }
}

describe('DeclarativePageAction', () => {
  it('shows pending state and suppresses duplicate clicks while running', async () => {
    let finish!: () => void
    const onClick = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    render(<DeclarativePageAction definition={{ id: 'run', label: 'Run', onClick }} context={actionContext()} />)

    const button = screen.getByRole('button', { name: 'Run' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')

    finish()
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBeNull() })
  })

  it('reports thrown errors through the page notice channel', async () => {
    const notify = vi.fn()
    render(
      <DeclarativePageAction
        definition={{ id: 'fail', label: 'Fail', onClick: async () => { throw new Error('action failed') } }}
        context={actionContext(notify)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fail' }))
    await waitFor(() => { expect(notify).toHaveBeenCalledWith('action failed', { tone: 'error' }) })
  })
})
